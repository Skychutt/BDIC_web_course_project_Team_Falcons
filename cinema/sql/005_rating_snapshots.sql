-- Source percentages are rounded published values, never reconstructed vote counts.
CREATE TABLE IF NOT EXISTS film_rating_snapshots (
 film_id BIGINT NOT NULL PRIMARY KEY,
 source_name VARCHAR(40) NOT NULL,
 source_url VARCHAR(255) NOT NULL,
 source_title VARCHAR(255) NOT NULL,
 checked_on DATE NOT NULL,
 score DECIMAL(3,1) NOT NULL,
 vote_count BIGINT NOT NULL,
 star_5 DECIMAL(4,1) NOT NULL,
 star_4 DECIMAL(4,1) NOT NULL,
 star_3 DECIMAL(4,1) NOT NULL,
 star_2 DECIMAL(4,1) NOT NULL,
 star_1 DECIMAL(4,1) NOT NULL,
 FOREIGN KEY (film_id) REFERENCES films(id) ON DELETE CASCADE,
 CHECK (score BETWEEN 0 AND 10 AND vote_count > 0),
 CHECK (star_5 BETWEEN 0 AND 100 AND star_4 BETWEEN 0 AND 100
    AND star_3 BETWEEN 0 AND 100 AND star_2 BETWEEN 0 AND 100 AND star_1 BETWEEN 0 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
