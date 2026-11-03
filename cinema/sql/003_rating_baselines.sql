-- Imported initial rating totals and subsequent customer votes share one scale.
CREATE TABLE IF NOT EXISTS film_rating_baselines (
 film_id BIGINT NOT NULL PRIMARY KEY,
 score DECIMAL(3,1) NOT NULL,
 vote_count BIGINT NOT NULL,
 CHECK (score BETWEEN 1 AND 10), CHECK (vote_count>0),
 FOREIGN KEY (film_id) REFERENCES films(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
CREATE TABLE IF NOT EXISTS rating_schema_versions (
 version VARCHAR(40) NOT NULL PRIMARY KEY,
 applied_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
