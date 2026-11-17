-- Immutable customer cancellation amounts, separate from rescheduling fees.
CREATE TABLE IF NOT EXISTS booking_cancellations (
 id BIGINT NOT NULL PRIMARY KEY,
 booking_id BIGINT NOT NULL UNIQUE,
 operation_id BIGINT NOT NULL UNIQUE,
 refund_id BIGINT NULL UNIQUE,
 ticket_value_minor BIGINT NOT NULL,
 fee_rate_bps INT NOT NULL,
 fee_minor BIGINT NOT NULL,
 refund_minor BIGINT NOT NULL,
 created_at DATETIME(6) NOT NULL,
 CHECK (ticket_value_minor>=0 AND fee_rate_bps IN (0,500,2000)),
 CHECK (fee_minor=(ticket_value_minor*fee_rate_bps+5000) DIV 10000),
 CHECK (refund_minor=ticket_value_minor-fee_minor AND refund_minor>=0),
 CHECK ((refund_minor=0 AND refund_id IS NULL) OR (refund_minor>0 AND refund_id IS NOT NULL)),
 FOREIGN KEY (booking_id) REFERENCES bookings(id),
 FOREIGN KEY (operation_id) REFERENCES operations(id),
 FOREIGN KEY (refund_id) REFERENCES refunds(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
