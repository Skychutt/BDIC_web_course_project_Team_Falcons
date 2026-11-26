"""Community writes run against the fixture's disposable schema, never demo data."""
from cinema.community import initialize_community
from cinema.core import db, execute, ins, one, rows


def client_for(env, name="customer"):
    client = env["app"].test_client()
    csrf = client.get("/api/auth/csrf").json["data"]["csrf_token"]
    result = client.post("/api/auth/login", json={"email": name + "@cinema.test", "password": "CinemaTest2026!"},
                         headers={"X-CSRF-Token": csrf})
    assert result.status_code == 200
    return client, {"X-CSRF-Token": result.json["data"]["csrf_token"]}


def test_repeatable_migration_preserves_ratings_and_catalogue(env):
    client, headers = client_for(env)
    fid = env["ids"]["film_id"]
    with db().begin() as c:
        execute(c, "INSERT INTO film_rating_baselines VALUES(:f,8.0,2)", f=fid)
    url = f"/api/community/films/{fid}/review"
    assert client.put(url, headers=headers, json={"stars": 8, "body": "A fine film."}).status_code == 200
    initialize_community(db())
    initialize_community(db())
    response = client.put(url, headers=headers, json={"stars": 10, "body": "Even better the second time.", "spoiler": True})
    assert response.json["data"] == {"average": "8.7", "count": 3, "scale": 10}
    summary = client.get(f"/api/community/films/{fid}").json["data"]
    assert summary["own_rating"]["stars"] == 10 and summary["own_review"]["spoiler"]
    assert summary["counts"] == {"reviews": 1, "threads": 0}
    assert summary["votes"] == [{"stars": 10, "count": 1}]
    assert summary["imported_votes"] == 2
    assert client.get(f"/api/films/{fid}").json["data"]["rating"] == response.json["data"]
    bootstrap = client.get("/api/ui/bootstrap").json["data"]
    assert next(f for f in bootstrap["films"] if f["id"] == str(fid))["rating"] == response.json["data"]
    public = env["app"].test_client()
    review = public.get(url + "s").json["data"]["items"][0]
    assert set(review["author"]) == {"id", "display_name"}
    assert review["is_demo_customer"] is True
    assert "email" not in str(review) and "password" not in str(review)
    assert public.get(f"/api/community/films/{fid}").json["data"]["own_rating"] is None
    assert client.delete(url, headers=headers).status_code == 200
    assert client.get(f"/api/community/films/{fid}").json["data"]["own_rating"]["stars"] == 10
    with db().connect() as c:
        assert one(c, "SELECT COUNT(*) AS n FROM ratings")["n"] == 1
        assert one(c, "SELECT COUNT(*) AS n FROM film_reviews")["n"] == 0


def test_review_validation_csrf_and_roles(env):
    fid = env["ids"]["film_id"]
    url = f"/api/community/films/{fid}/review"
    guest = env["app"].test_client()
    token = guest.get("/api/auth/csrf").json["data"]["csrf_token"]
    assert guest.put(url, json={"stars": 10}).status_code == 403
    assert guest.put(url, headers={"X-CSRF-Token": token}, json={"stars": 10}).status_code == 401
    staff, headers = client_for(env, "staff1")
    assert staff.put(url, headers=headers, json={"stars": 10}).status_code == 403
    customer, headers = client_for(env)
    for payload in ({"stars": 0}, {"stars": 11}, {"stars": True}, {"stars": 8.5}, {"stars": 8, "body": "x" * 2001}, {"stars": 8, "spoiler": "false"}):
        assert customer.put(url, headers=headers, json=payload).status_code == 400
    assert customer.put(url.replace(str(fid), "999999"), headers=headers, json={"stars": 8}).status_code == 404
    with db().connect() as c:
        assert not rows(c, "SELECT * FROM ratings")


def test_short_review_rating_only_and_legacy_odd_score(env):
    client, headers = client_for(env)
    fid = env["ids"]["film_id"]
    url = f"/api/community/films/{fid}/review"
    for text in ("Legacy half-star vote", ""):
        assert client.put(url, headers=headers, json={"stars": 7, "body": text}).status_code == 200
    data = client.get(f"/api/community/films/{fid}").json["data"]
    assert data["own_rating"]["stars"] == 7 and data["own_review"] is None


def test_threads_replies_retry_ownership_and_removal(env):
    first, h1 = client_for(env)
    second, h2 = client_for(env, "customer2")
    fid = env["ids"]["film_id"]
    url = f"/api/community/films/{fid}/threads"
    post = {"title": "The ending?", "body": '<script>alert("test")</script>', "spoiler": True}
    h1["Idempotency-Key"] = "community-thread-1"
    response = first.post(url, headers=h1, json=post)
    assert response.status_code == 201
    tid = response.json["data"]["id"]
    assert first.post(url, headers=h1, json=post).json["data"]["id"] == tid
    assert first.post(url, headers=h1, json={**post, "title": "Changed"}).status_code == 409
    thread_url = f"/api/community/threads/{tid}"
    h2["Idempotency-Key"] = "community-reply-1"
    response = second.post(thread_url + "/replies", headers=h2, json={"body": "A different interpretation."})
    assert response.status_code == 201
    rid = response.json["data"]["id"]
    assert second.post(thread_url + "/replies", headers=h2, json={"body": "A different interpretation."}).json["data"]["id"] == rid
    detail = first.get(thread_url).json["data"]
    assert detail["replies"]["total"] == 1
    assert detail["thread"]["body"] == post["body"]  # Stored as text; browser must escape it.
    assert set(detail["thread"]["author"]) == {"id", "display_name"}
    assert detail["thread"]["is_demo_customer"] and detail["replies"]["items"][0]["is_demo_customer"]
    assert "name_source_email" not in str(detail)
    assert "payload_hash" not in detail["thread"] and "request_key" not in detail["thread"]
    assert second.delete(thread_url, headers=h2).status_code == 403
    assert first.delete(f"/api/community/replies/{rid}", headers=h1).status_code == 403
    assert second.delete(f"/api/community/replies/{rid}", headers=h2).status_code == 200
    assert first.get(thread_url).json["data"]["replies"]["total"] == 0
    assert first.delete(thread_url, headers=h1).status_code == 200
    assert first.get(thread_url).status_code == 404
    assert second.post(thread_url + "/replies", headers={**h2, "Idempotency-Key": "after-delete-1"}, json={"body": "Too late"}).status_code == 404
    assert first.post(url, headers=h1, json=post).status_code == 404


def test_pagination_film_isolation_and_admin_moderation(env):
    customer, headers = client_for(env)
    fid = env["ids"]["film_id"]
    url = f"/api/community/films/{fid}/threads"
    ids = set()
    for i in range(3):
        response = customer.post(url, headers={**headers, "Idempotency-Key": f"community-page-{i}"}, json={"title": f"Topic {i}", "body": "A thought."})
        assert response.status_code == 201
        ids.add(response.json["data"]["id"])
    pages = [customer.get(url + f"?page_size=2&page={i}").json["data"] for i in (1, 2)]
    assert len(pages[0]["items"]) == 2 and len(pages[1]["items"]) == 1
    assert {t["id"] for page in pages for t in page["items"]} == ids
    assert all(page["total"] == 3 for page in pages)
    with db().begin() as c:
        other = ins(c, "films", title="Another film", synopsis="Independent discussion", duration_minutes=90, archived=False)
    assert customer.get(f"/api/community/films/{other}/threads").json["data"]["total"] == 0
    assert customer.get(url + "?page_size=500").status_code == 400
    admin, admin_headers = client_for(env, "admin")
    tid = next(iter(ids))
    thread_url = f"/api/community/threads/{tid}"
    reply_ids = [customer.post(thread_url + "/replies", json={"body": f"Reply {i}"},
                               headers={**headers, "Idempotency-Key": f"moderation-reply-{i}"}).json["data"]["id"]
                 for i in range(2)]
    moderation = "/api/community/moderation/posts"
    assert env["app"].test_client().get(moderation).status_code == 401
    for user in ("customer", "staff1", "manager1"):
        viewer, _ = client_for(env, user)
        assert viewer.get(moderation).status_code == 403
    pages = [admin.get(moderation + f"?page_size=2&page={i}").json["data"] for i in (1, 2, 3)]
    assert [p["has_next"] for p in pages] == [True, True, False]
    posts = [post for page in pages for post in page["items"]]
    assert {p["id"] for p in posts if p["kind"] == "thread"} == ids
    assert {p["id"] for p in posts if p["kind"] == "reply"} == set(reply_ids)
    assert admin.delete(f"/api/community/replies/{reply_ids[0]}", headers=admin_headers).status_code == 200
    assert len(admin.get(moderation).json["data"]["items"]) == 4
    assert admin.delete(thread_url, headers=admin_headers).status_code == 200
    assert {p["id"] for p in admin.get(moderation).json["data"]["items"]} == ids - {tid}
    assert customer.get(url).json["data"]["total"] == 2


def test_directory_count_and_review_author_isolation(env):
    first, h1 = client_for(env)
    second, h2 = client_for(env, "customer2")
    fid = env["ids"]["film_id"]
    path = f"/api/community/films/{fid}/review"
    assert first.put(path, headers=h1, json={"stars": 4, "body": "First take"}).status_code == 200
    assert second.put(path, headers=h2, json={"stars": 10, "body": "Second take"}).status_code == 200
    assert first.delete(path, headers=h1).status_code == 200
    review = second.get(path + "s").json["data"]
    assert review["total"] == 1 and review["items"][0]["body"] == "Second take"
    directory = second.get("/api/community/films").json["data"]
    film = next(f for f in directory if f["id"] == str(fid))
    assert film["review_count"] == 1 and film["rating"]["count"] == 2

def test_community_posts_reject_unknown_fields(env):
    client, headers = client_for(env)
    fid = env["ids"]["film_id"]
    headers = {**headers, "Idempotency-Key": "community-unknown-1"}
    bad_thread = client.post(
        f"/api/community/films/{fid}/threads",
        headers=headers,
        json={"title": "Hello", "body": "World", "spoiler": False, "extra": 1},
    )
    assert bad_thread.status_code == 400
    assert bad_thread.json["error"]["code"] == "VALIDATION"
    headers["Idempotency-Key"] = "community-unknown-2"
    good = client.post(
        f"/api/community/films/{fid}/threads",
        headers=headers,
        json={"title": "Hello", "body": "World", "spoiler": False},
    )
    assert good.status_code == 201
    tid = good.json["data"]["id"]
    headers["Idempotency-Key"] = "community-unknown-3"
    bad_reply = client.post(
        f"/api/community/threads/{tid}/replies",
        headers=headers,
        json={"body": "A reply", "title": "not allowed"},
    )
    assert bad_reply.status_code == 400
    assert bad_reply.json["error"]["code"] == "VALIDATION"
