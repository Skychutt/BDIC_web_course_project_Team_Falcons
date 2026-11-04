# Wang Tingdong：AI、查询与评分

维护责任，不是对已完成代码的作者认领。本文件夹中的文件从团队快照原样复制。

## 统计范围内的业务代码：3,493 行（24.4%）

`cinema_ai` 下全部 Python，加上 `cinema/assistant_reads.py`、`cinema/discovery.py`、`cinema/ratings.py`，以及助手、查询、目录和评分相关的 JS/CSS：

- `cinema/static/js/assistant.js`
- `cinema/static/js/assistant-locale.js`
- `cinema/static/js/assistant-widget.js`
- `cinema/static/assistant-widget.css`
- `cinema/static/js/catalogue.js`
- `cinema/static/js/discover.js`
- `cinema/static/js/film-rating.js`

## 独立测试：1,507 行

- `tests/test_agent.py`、`tests/test_chat.py`、`tests/test_provider.py`
- `tests/test_candidate_references.py`、`tests/test_condition_lifecycle.py`
- `tests/test_catalog.py`、`tests/test_localization.py`
- `tests/conftest.py`
- `tests/frontend/assistant-link.test.mjs`、`tests/frontend/assistant-locale.test.mjs`
- `backend_tests/test_agent_reads.py`、`backend_tests/test_ai_bridge.py`、`backend_tests/test_unified_ratings.py`

## 综合测试中的 40 行

文件 `backend_tests/test_integration.py` 未拆分，不在本文件夹。负责其中：

- `test_rating_edit_and_no_purchase_required`（第 473–485 行）
- `test_search_hard_filters_and_read_does_not_hold`（第 486–512 行）

评分迁移测试与 Chu Tianze 一起检查。

## 验收重点

硬条件不被擅自放宽；不能读取他人订单；超时仍有合理反馈；评分来源说明准确。

## 统计范围外、随本模块附上的文件

助手独立页面、规则与译文、示例脚本、说明和影片海报：`cinema_ai/static/`、`cinema_ai/templates/assistant.html`、`cinema_ai/data/`、`examples/smoke_agent.py`、`docs/business-agent.md`、`cinema/static/assets/` 下六张海报。这些不计入 3,493 行。
