import json
from types import SimpleNamespace

import httpx
import pytest
from openai import APIStatusError, APITimeoutError

from cinema_ai.providers import DeepSeekProvider, ProviderError
from cinema_ai import create_app


class FakeCompletions:
    def __init__(self, content=None, finish="stop", exception=None):
        self.content, self.finish, self.exception = content, finish, exception
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.exception:
            raise self.exception
        return SimpleNamespace(choices=[SimpleNamespace(finish_reason=self.finish, message=SimpleNamespace(content=self.content))], usage=SimpleNamespace(prompt_tokens=10, completion_tokens=20))


def provider(completions):
    return DeepSeekProvider("unused", client=SimpleNamespace(chat=SimpleNamespace(completions=completions)))


def interpret(p):
    return p.interpret("Three people tomorrow", {}, [], "2026-10-23", 3.5)


def test_deepseek_wire_contract_and_schema():
    fake = FakeCompletions(json.dumps({"intent": "recommend", "updates": {"party_size": 3, "date": "tomorrow"}}))
    result = interpret(provider(fake))
    assert result.updates.party_size == 3
    call = fake.calls[0]
    assert call["model"] == "deepseek-flash"
    assert call["response_format"] == {"type": "json_object"}
    assert call["extra_body"] == {"thinking": {"type": "disabled"}}
    assert call["timeout"] == 3.5 and not call["stream"]
    assert "JSON" in call["messages"][0]["content"]
    assert "unused" not in json.dumps(call)


@pytest.mark.parametrize("content,finish", [
    ("", "stop"), (None, "stop"), ("not JSON", "stop"), ('{"intent":"recommend"', "length"),
    ('{"intent":"recommend","updates":{"party_size":"3"}}', "stop"),
    ('{"intent":"recommend","updates":{"film_id":999}}', "stop"),
    ('{"intent":"sql","updates":{}}', "stop"),
    ('{"intent":"recommend","url":"https://attacker.invalid"}', "stop"),
])
def test_invalid_model_output_is_rejected(content, finish):
    fake = FakeCompletions(content, finish)
    with pytest.raises(ProviderError) as caught:
        interpret(provider(fake))
    assert caught.value.code == "invalid_output" and len(fake.calls) == 1


@pytest.mark.parametrize("status,code", [(401, "authentication"), (402, "quota"), (429, "rate_limit"), (500, "upstream"), (503, "upstream")])
def test_provider_errors_are_sanitized(status, code, caplog):
    request = httpx.Request("POST", "https://api.deepseek.com/chat/completions")
    failure = APIStatusError("secret-key-and-private-user-message", response=httpx.Response(status, request=request), body={"private": "data"})
    fake = FakeCompletions(exception=failure)
    with pytest.raises(ProviderError) as caught:
        interpret(provider(fake))
    assert caught.value.code == code and len(fake.calls) == 1
    assert "secret-key" not in caplog.text and "private-user-message" not in str(caught.value)


def test_client_has_no_automatic_retries():
    p = DeepSeekProvider("test-key-not-a-real-secret")
    assert p.client.max_retries == 0
    assert str(p.client.base_url) == "https://api.deepseek.com"
    p.client.close()


def test_no_key_error():
    with pytest.raises(ProviderError) as caught:
        interpret(DeepSeekProvider(""))
    assert caught.value.code == "missing_key"


def test_native_chat_preserves_free_text_and_uses_configured_deadline():
    answer = "概念解释：\n" + "这是一个用于学习的代码示例。\n" * 30
    fake = FakeCompletions(answer)
    turn = provider(fake).turn(messages=[{"role": "user", "content": "请详细解释一下"}], tool_definitions=[], timeout=30)
    assert turn.content == answer and not turn.calls
    assert fake.calls[0]["timeout"] == 30 and fake.calls[0]["max_tokens"] == 2400


def test_length_limited_text_is_returned_instead_of_discarded():
    fake = FakeCompletions("Here is the first part of the explanation.", finish="length")
    turn = provider(fake).turn(messages=[], tool_definitions=[], timeout=30)
    assert turn.content == fake.content and turn.truncated and not turn.calls


def test_length_limited_tool_arguments_are_never_accepted():
    def create(**kwargs):
        return SimpleNamespace(usage=None, choices=[SimpleNamespace(finish_reason="length", message=SimpleNamespace(
            content=None, tool_calls=[SimpleNamespace(type="function", id="a", function=SimpleNamespace(name="get_my_orders", arguments="{}"))]))])
    with pytest.raises(ProviderError, match="invalid_output"):
        provider(SimpleNamespace(create=create)).turn(messages=[], tool_definitions=[], timeout=30)


@pytest.mark.parametrize("timeout", [30, 60])
def test_longer_chat_budget_is_configurable(timeout):
    app = create_app({"TESTING": True, "DATA_SOURCE": "mock", "AI_PROVIDER": "stub", "AI_TIMEOUT_SECONDS": timeout})
    assert app.extensions["cinema_ai"]["chat"].timeout == timeout
    app.extensions["cinema_ai"]["runner"].pool.shutdown()


@pytest.mark.parametrize("timeout", [0, -1, 61, float("nan"), float("inf")])
def test_chat_budget_stays_bounded(timeout):
    with pytest.raises(ValueError, match="AI_TIMEOUT_SECONDS"):
        create_app({"TESTING": True, "DATA_SOURCE": "mock", "AI_PROVIDER": "stub", "AI_TIMEOUT_SECONDS": timeout})
