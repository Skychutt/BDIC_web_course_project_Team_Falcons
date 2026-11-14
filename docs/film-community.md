# Film reviews and discussions

The header's **Reviews** entry opens `#/reviews`. Film details link to
`#/reviews/film/<film_id>`, which has short reviews and discussions. Topics open
at `#/reviews/thread/<thread_id>`. All pages use the existing login and catalogue.

## Database upgrade

For an existing installation, activate the virtual environment, check that `.env`
points to the intended MySQL database, then run:

```sh
python -m flask --app cinema:create_app migrate-community
```

Restart `main.py` after updating the code. This repeatable command only creates
`film_reviews`, `film_threads`, and `film_replies` if absent. It does not recreate
the database, import a programme, or change existing accounts, bookings or ratings.
New installations include these tables through the existing `init-db` command.

## Behaviour

- Customers can rate without buying a ticket. Five displayed stars map to
  2, 4, 6, 8 or 10 points in the existing `ratings` table. Previously stored odd
  scores display as half stars and are kept until the user selects a new rating.
- Each customer has one rating and one optional short review per film. Saving
  updates both atomically. Clearing a short review removes its text; deleting the
  short review keeps the star rating.
- Catalogue, ticketing and AI scores keep the existing weighted aggregate of
  imported baselines and customer votes. The community histogram explicitly shows
  only local customer votes; imported votes are labelled separately.
- Public readers see display names only. Email addresses, credentials, session
  data and idempotency keys are not returned in public conversations.
- Short reviews have a 2,000-character limit; topics have a 160-character title
  and 8,000-character body; replies have a 2,000-character limit. All user text is
  rendered as escaped plain text. Spoiler reviews and discussion bodies are
  collapsed; replies to spoiler topics are collapsed too.
- Topics and replies require an idempotency key, so retrying the same submission
  does not create duplicates. Authors and platform administrators can remove their
  permitted posts. Removed topics and their replies are hidden from public access.
- Lists are paginated. Existing CSRF and login protection apply to all writes.

## Verification

`backend_tests/test_community.py` uses a newly created, disposable test schema.
It covers schema repeatability, score consistency, validation, authentication,
CSRF, ownership, retries, deletion, pagination, film isolation and public privacy.

```sh
python -m pytest backend_tests/test_community.py backend_tests/test_unified_ratings.py -q
node --test tests/frontend/star-rating.test.mjs
```

Set `TEST_DATABASE_URL` to an explicitly chosen MySQL account allowed to create
and drop disposable schemas. Browser tests use `scripts/browser_fixture.py` on
port 5002, then `node tests/browser/community-smoke.mjs`. If using installed
Chrome instead of bundled Chromium, set `PLAYWRIGHT_CHANNEL=chrome`.
Browser screenshots and results are written to the ignored `output/community-qa/`.
