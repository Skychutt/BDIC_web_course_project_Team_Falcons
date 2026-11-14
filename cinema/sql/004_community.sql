-- Additive, repeatable migration. Existing films, ratings and bookings are unchanged.
CREATE TABLE IF NOT EXISTS film_reviews (
 id BIGINT NOT NULL PRIMARY KEY,
 film_id BIGINT NOT NULL,
 customer_id BIGINT NOT NULL,
 body TEXT NOT NULL,
 spoiler BOOLEAN NOT NULL DEFAULT FALSE,
 created_at DATETIME(6) NOT NULL,
 updated_at DATETIME(6) NOT NULL,
 UNIQUE KEY uq_review_author_film (customer_id,film_id),
 KEY ix_review_film_date (film_id,created_at,id),
 FOREIGN KEY (film_id) REFERENCES films(id),
 FOREIGN KEY (customer_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE IF NOT EXISTS film_threads (
 id BIGINT NOT NULL PRIMARY KEY,
 film_id BIGINT NOT NULL,
 author_id BIGINT NOT NULL,
 title VARCHAR(160) NOT NULL,
 body TEXT NOT NULL,
 spoiler BOOLEAN NOT NULL DEFAULT FALSE,
 deleted BOOLEAN NOT NULL DEFAULT FALSE,
 request_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 payload_hash CHAR(64) NOT NULL,
 created_at DATETIME(6) NOT NULL,
 UNIQUE KEY uq_thread_request (author_id,request_key),
 KEY ix_thread_film_date (film_id,deleted,created_at,id),
 FOREIGN KEY (film_id) REFERENCES films(id),
 FOREIGN KEY (author_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE IF NOT EXISTS film_replies (
 id BIGINT NOT NULL PRIMARY KEY,
 thread_id BIGINT NOT NULL,
 author_id BIGINT NOT NULL,
 body TEXT NOT NULL,
 deleted BOOLEAN NOT NULL DEFAULT FALSE,
 request_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 payload_hash CHAR(64) NOT NULL,
 created_at DATETIME(6) NOT NULL,
 UNIQUE KEY uq_reply_request (author_id,request_key),
 KEY ix_reply_thread_date (thread_id,deleted,created_at,id),
 FOREIGN KEY (thread_id) REFERENCES film_threads(id),
 FOREIGN KEY (author_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
