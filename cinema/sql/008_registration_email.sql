CREATE TABLE IF NOT EXISTS registration_send_locks (
    bucket CHAR(64) CHARACTER SET ascii PRIMARY KEY,
    touched_at DATETIME(6) NOT NULL,
    KEY registration_idle (touched_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS registration_codes (
    challenge CHAR(32) CHARACTER SET ascii PRIMARY KEY,
    email_key CHAR(64) CHARACTER SET ascii NOT NULL,
    source_key CHAR(64) CHARACTER SET ascii NOT NULL,
    code_hash CHAR(64) CHARACTER SET ascii NOT NULL,
    created_at DATETIME(6) NOT NULL,
    attempts_left TINYINT UNSIGNED NOT NULL,
    KEY registration_email_time (email_key, created_at),
    KEY registration_source_time (source_key, created_at),
    KEY registration_expiry (created_at)
) ENGINE=InnoDB;
