"""Film conversations share catalogue identities and the existing rating scale."""
from importlib.resources import files
from flask import Blueprint, g, request

from . import catalog
from .auth import mark_demo_customer
from .rating_snapshots import get_snapshot
from .api import body, key, logged, output
from .core import db, digest, execute, get, ins, integer, new_id, now, one, require, role, rows, string, transaction

community = Blueprint("community", __name__, url_prefix="/api/community")


def initialize_community(engine):
    script = files("cinema").joinpath("sql/004_community.sql").read_text(encoding="utf-8")
    script = "\n".join(line for line in script.splitlines() if not line.lstrip().startswith("--"))
    with engine.begin() as c:
        for statement in script.split(";"):
            if statement.strip():
                c.exec_driver_sql(statement)


def pagination():
    page = integer(request.args.get("page", 1), "page", 1, 10000)
    size = integer(request.args.get("page_size", 10), "page_size", 1, 50)
    return page, size, (page - 1) * size


def spoiler_flag(data):
    value = data.get("spoiler", False)
    require(isinstance(value, bool), "VALIDATION", "spoiler must be true or false")
    return value


def author(item):
    # Public conversations never expose email addresses or account/session fields.
    mark_demo_customer(item, "display_name")
    item["author"] = {"id": item.pop("author_id"), "display_name": item.pop("display_name")}
    return item


def active_thread(c, tid, lock=False):
    thread = get(c, "film_threads", tid, lock)
    require(not thread["deleted"], "NOT_FOUND", "This discussion is no longer available", 404)
    return thread


@community.get("/films")
def film_directory():
    from .frontend_api import film_metadata
    with db().connect() as c:
        films = rows(c, """SELECT f.id,f.title,f.synopsis,f.duration_minutes,
            (SELECT COUNT(*) FROM film_reviews r WHERE r.film_id=f.id) AS review_count,
            (SELECT COUNT(*) FROM film_threads t WHERE t.film_id=f.id AND t.deleted=0) AS thread_count
            FROM films f WHERE f.archived=0 ORDER BY f.title,f.id""")
        return output(film_metadata(c, films))


@community.get("/films/<int:fid>")
def overview(fid):
    with db().connect() as c:
        film = catalog.film_detail(c, fid)
        counts = one(c, """SELECT
            (SELECT COUNT(*) FROM film_reviews WHERE film_id=:f) AS reviews,
            (SELECT COUNT(*) FROM film_threads WHERE film_id=:f AND deleted=0) AS threads""", f=fid)
        votes = rows(c, "SELECT stars,COUNT(*) AS count FROM ratings WHERE film_id=:f GROUP BY stars", f=fid)
        own_rating = own_review = None
        if g.actor:
            own_rating = one(c, "SELECT stars FROM ratings WHERE film_id=:f AND customer_id=:u", f=fid, u=g.actor["id"])
            own_review = one(c, "SELECT body,spoiler FROM film_reviews WHERE film_id=:f AND customer_id=:u", f=fid, u=g.actor["id"])
        snapshot = get_snapshot(c, fid)
        imported = snapshot or one(c, "SELECT vote_count FROM film_rating_baselines WHERE film_id=:f", f=fid)
        return output(dict(film=film, counts=counts, votes=votes, own_rating=own_rating,
                           own_review=own_review, imported_votes=imported["vote_count"] if imported else 0,
                           rating_snapshot=snapshot))


@community.get("/films/<int:fid>/reviews")
def reviews(fid):
    page, size, offset = pagination()
    with db().connect() as c:
        get(c, "films", fid)
        items = rows(c, """SELECT r.id,r.body,r.spoiler,r.created_at,r.updated_at,
            r.customer_id AS author_id,u.display_name,u.email_normalized AS name_source_email,v.stars
            FROM film_reviews r JOIN users u ON u.id=r.customer_id
            LEFT JOIN ratings v ON v.customer_id=r.customer_id AND v.film_id=r.film_id
            WHERE r.film_id=:f ORDER BY r.created_at DESC,r.id DESC LIMIT :n OFFSET :o""", f=fid, n=size, o=offset)
        total = one(c, "SELECT COUNT(*) AS n FROM film_reviews WHERE film_id=:f", f=fid)["n"]
        return output(dict(items=[author(r) for r in items], total=total, page=page, page_size=size))


@community.put("/films/<int:fid>/review")
@logged
def save_review(fid):
    role(g.actor, "CUSTOMER")
    data = body()
    score = integer(data.get("stars"), "stars", 1, 10)
    content = string(data.get("body", ""), "Review", 2000, 0)
    spoiler = spoiler_flag(data)
    uid = g.actor["id"]

    def work(c):
        # Serialise edits by this author, including a simultaneous rating-only edit.
        get(c, "users", uid, True)
        get(c, "films", fid)
        catalog.save_rating(c, uid, fid, score)
        if content:
            execute(c, """INSERT INTO film_reviews(id,film_id,customer_id,body,spoiler,created_at,updated_at)
                VALUES(:id,:f,:u,:body,:s,:n,:n)
                ON DUPLICATE KEY UPDATE body=:body,spoiler=:s,updated_at=:n""",
                id=new_id(), f=fid, u=uid, body=content, s=spoiler, n=now())
        else:
            execute(c, "DELETE FROM film_reviews WHERE film_id=:f AND customer_id=:u", f=fid, u=uid)
        return catalog.film_detail(c, fid)["rating"]

    return output(transaction(work))


@community.delete("/films/<int:fid>/review")
@logged
def remove_review(fid):
    role(g.actor, "CUSTOMER")
    def work(c):
        get(c, "users", g.actor["id"], True)
        execute(c, "DELETE FROM film_reviews WHERE film_id=:f AND customer_id=:u", f=fid, u=g.actor["id"])
        return {"removed": True}
    return output(transaction(work))


@community.get("/films/<int:fid>/threads")
def threads(fid):
    page, size, offset = pagination()
    with db().connect() as c:
        get(c, "films", fid)
        items = rows(c, """SELECT t.id,t.film_id,t.title,t.spoiler,t.created_at,t.author_id,u.display_name,
            u.email_normalized AS name_source_email,
            (SELECT COUNT(*) FROM film_replies r WHERE r.thread_id=t.id AND r.deleted=0) AS reply_count
            FROM film_threads t JOIN users u ON u.id=t.author_id
            WHERE t.film_id=:f AND t.deleted=0 ORDER BY t.created_at DESC,t.id DESC LIMIT :n OFFSET :o""", f=fid, n=size, o=offset)
        total = one(c, "SELECT COUNT(*) AS n FROM film_threads WHERE film_id=:f AND deleted=0", f=fid)["n"]
        return output(dict(items=[author(t) for t in items], total=total, page=page, page_size=size))


def create_post(table, parent, parent_id, data, request_id):
    actor = g.actor
    role(actor, "CUSTOMER")
    allowed = {"body", "title", "spoiler"} if table == "film_threads" else {"body"}
    require(set(data) <= allowed, "VALIDATION", "Unexpected fields in community post")
    content = string(data.get("body"), "Message", 8000 if table == "film_threads" else 2000)
    values = dict(body=content)
    if table == "film_threads":
        values.update(title=string(data.get("title"), "Title", 160), spoiler=spoiler_flag(data))
    payload = dict(parent_id=parent_id, **values)

    def work(c):
        # Lock the parent thread before its author for consistent reply/delete ordering.
        if table == "film_replies":
            active_thread(c, parent_id, True)
        else:
            get(c, "films", parent_id)
        get(c, "users", actor["id"], True)
        existing = one(c, f"SELECT id,payload_hash,deleted FROM {table} WHERE author_id=:a AND request_key=:k",
                       a=actor["id"], k=request_id)
        if existing:
            require(existing["payload_hash"] == digest(payload), "IDEMPOTENCY_CONFLICT", "Request key was used for different input", 409)
            require(not existing["deleted"], "NOT_FOUND", "This post was removed", 404)
            return {"id": existing["id"]}
        ident = ins(c, table, **{parent: parent_id}, author_id=actor["id"], **values,
                    request_key=request_id, payload_hash=digest(payload), created_at=now())
        return {"id": ident}
    return transaction(work)


@community.post("/films/<int:fid>/threads")
@logged
def create_thread(fid):
    return output(create_post("film_threads", "film_id", fid, body(), key()), 201)


@community.get("/threads/<int:tid>")
def thread_detail(tid):
    page, size, offset = pagination()
    with db().connect() as c:
        thread = active_thread(c, tid)
        thread = {k: thread[k] for k in ("id", "film_id", "title", "body", "spoiler", "created_at", "author_id")}
        user = get(c, "users", thread["author_id"])
        thread.update(display_name=user["display_name"], name_source_email=user["email_normalized"])
        replies = rows(c, """SELECT r.id,r.body,r.created_at,r.author_id,u.display_name,
            u.email_normalized AS name_source_email
            FROM film_replies r JOIN users u ON u.id=r.author_id
            WHERE r.thread_id=:t AND r.deleted=0 ORDER BY r.created_at,r.id LIMIT :n OFFSET :o""", t=tid, n=size, o=offset)
        total = one(c, "SELECT COUNT(*) AS n FROM film_replies WHERE thread_id=:t AND deleted=0", t=tid)["n"]
        return output(dict(thread=author(thread), film=catalog.film_detail(c, thread["film_id"]),
                           replies=dict(items=[author(r) for r in replies], total=total, page=page, page_size=size)))


@community.post("/threads/<int:tid>/replies")
@logged
def create_reply(tid):
    return output(create_post("film_replies", "thread_id", tid, body(), key()), 201)


def delete_post(table, ident):
    def work(c):
        item = get(c, table, ident, True)
        require(item["author_id"] == g.actor["id"] or g.actor["role"] == "PLATFORM_ADMIN",
                "FORBIDDEN", "Only the author or a platform administrator can remove this post", 403)
        execute(c, f"UPDATE {table} SET deleted=1 WHERE id=:id", id=ident)
        return {"removed": True}
    return output(transaction(work))


@community.get("/moderation/posts")
@logged
def moderation_posts():
    role(g.actor, "PLATFORM_ADMIN")
    page, size, offset = pagination()
    with db().connect() as c:
        posts = rows(c, """
            SELECT p.id,p.kind,t.title AS thread_title,p.body,p.created_at,u.display_name,
                u.email_normalized AS name_source_email,f.title AS film_title
            FROM (
                SELECT id,'thread' AS kind,id AS thread_id,author_id,body,created_at
                FROM film_threads WHERE deleted=0
                UNION ALL
                SELECT id,'reply' AS kind,thread_id,author_id,body,created_at
                FROM film_replies WHERE deleted=0
            ) p
            JOIN film_threads t ON t.id=p.thread_id AND t.deleted=0
            JOIN users u ON u.id=p.author_id JOIN films f ON f.id=t.film_id
            ORDER BY p.created_at DESC,p.id DESC,p.kind LIMIT :n OFFSET :o
        """, n=size + 1, o=offset)
    for post in posts:
        mark_demo_customer(post, "display_name")
    return output(dict(items=posts[:size], page=page, has_next=len(posts) > size))


@community.delete("/threads/<int:tid>")
@logged
def delete_thread(tid):
    return delete_post("film_threads", tid)


@community.delete("/replies/<int:rid>")
@logged
def delete_reply(rid):
    return delete_post("film_replies", rid)
