# Film reviews and discussions

The header's **Reviews** entry opens `#/reviews`. Film details link to
`#/reviews/film/<film_id>`, which has short reviews and discussions. Topics open
at `#/reviews/thread/<thread_id>`. All pages use the existing login and catalogue.

## Database upgrade

For an existing installation, activate the virtual environment, check that `.env`
points to the intended MySQL database, then run:

```sh
python -m flask --app cinema:create_app migrate-community
python -m flask --app cinema:create_app import-rating-snapshots data/film-rating-snapshots-20261114.json
```

Restart `main.py` after updating the code. This repeatable command only creates
`film_reviews`, `film_threads`, and `film_replies` if absent. It does not recreate
the database, import a programme, or change existing accounts, bookings or ratings.
New installations include these tables through the existing `init-db` command.
The unified rating display needs no additional migration when these tables and
snapshots are already installed. The second command adds `film_rating_snapshots` and imports the verified source
records. Run it after the film programme import, so the exact catalogue titles
exist. It is repeatable and preserves customer votes and imported baselines.

## Behaviour

- Customers can rate without buying a ticket. Five displayed stars map to
  2, 4, 6, 8 or 10 points in the existing `ratings` table. Previously stored odd
  scores display as half stars and are kept until the user selects a new rating.
- Each customer has one rating and one optional short review per film. Saving
  updates both atomically. Clearing a short review removes its text; deleting the
  short review keeps the star rating.
- The rating card has one audience score, count and five-star breakdown, with no
  source selector. Catalogue, ticketing, the community and AI use the same aggregate.
  When a verified Douban snapshot exists, its score and count replace the older
  baseline in the calculation; the baseline is not added a second time. The total
  count is the snapshot count plus actual customer votes. The score is
  `(snapshot score × snapshot count + sum of customer scores) / total count`,
  displayed to one decimal place. Films without snapshots retain their older
  baseline, or use customer votes alone if no baseline exists.
- Saving a rating refreshes the shared score and histogram and shows “Your rating
  is included”. Editing the same customer's rating replaces that vote, keeping
  the total count unchanged. With millions of imported votes, one new vote may
  not visibly change the rounded average or percentages; it still counts fully.
- All five programme films have source snapshots checked on 14 November 2026.
  `data/film-rating-snapshots-20261114.json` records their canonical subject URLs,
  source titles, verification dates, scores, counts and published percentages.
  Film identity was checked against the title, year and director on each source
  page. These are captured values, not a live Douban API connection.
- Each combined star percentage is
  `(published percentage × snapshot count + local bucket votes × 100) / total count`.
  This preserves the published percentages before any local votes and includes
  new votes in their respective star buckets. Published percentages are rounded,
  so this weighted breakdown remains approximate and can total 99.9% or 100.1%.
  A small source link and snapshot date remain available below the unified card.
  Exact imported bucket counts are not claimed or persisted, and no synthetic
  votes are inserted in `ratings`. The original snapshot is never changed by a vote.
  A legacy baseline without a histogram shows an unavailable breakdown; with no
  baseline or snapshot, only actual local votes are used. No votes means an empty state.
- Historical odd ten-point votes keep their exact value in the combined average;
  the histogram groups half-star votes with the next whole-star bucket.
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
python -m pytest backend_tests/test_rating_snapshots.py -q
node --test tests/frontend/rating-distribution.test.mjs
```

Set `TEST_DATABASE_URL` to an explicitly chosen MySQL account allowed to create
and drop disposable schemas. Browser tests use `scripts/browser_fixture.py` on
port 5002, then `node tests/browser/community-smoke.mjs`. If using installed
Chrome instead of bundled Chromium, set `PLAYWRIGHT_CHANNEL=chrome`.
Browser screenshots and results are written to the ignored `output/community-qa/`.
