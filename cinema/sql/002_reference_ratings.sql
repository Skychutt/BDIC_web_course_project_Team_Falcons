-- External snapshots are separate from customer-authored 1–5 star ratings.
CREATE TABLE IF NOT EXISTS film_reference_ratings (
 film_id BIGINT NOT NULL PRIMARY KEY,
 source VARCHAR(40) NOT NULL,
 score DECIMAL(3,1) NOT NULL,
 scale TINYINT NOT NULL DEFAULT 10,
 vote_count INT NOT NULL,
 captured_on DATE NOT NULL,
 provenance VARCHAR(200) NOT NULL,
 CHECK (scale=10), CHECK (score BETWEEN 0 AND 10), CHECK (vote_count>=0),
 FOREIGN KEY (film_id) REFERENCES films(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
