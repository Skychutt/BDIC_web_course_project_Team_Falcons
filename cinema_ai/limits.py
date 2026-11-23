"""Account message limits shared by the Flask workers on the cinema host."""
from contextlib import closing
from datetime import datetime, time, timedelta
import logging
import math
from pathlib import Path
import sqlite3

from .domain import BEIJING

log = logging.getLogger("cinema_ai.metrics")


class MessageLimits:
    def __init__(self, path, per_minute, per_day, ip_alert):
        self.path = Path(path)
        self.per_minute, self.per_day, self.ip_alert = map(int, (per_minute, per_day, ip_alert))
        if min(self.per_minute, self.per_day, self.ip_alert) < 1:
            raise ValueError("Assistant message limits and alert threshold must be positive")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path)) as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS messages (account TEXT NOT NULL, sent REAL NOT NULL, ip_tag TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS account_time ON messages(account, sent);
                CREATE INDEX IF NOT EXISTS ip_time ON messages(ip_tag, sent);
                CREATE INDEX IF NOT EXISTS expiry ON messages(sent);
            """)

    def admit(self, account, ip_tag, now):
        """Return seconds until admission, or record exactly one accepted message."""
        now = now.astimezone(BEIJING)
        stamp = now.timestamp()
        midnight = datetime.combine(now.date(), time.min, BEIJING)
        minute = stamp - 60
        # Serialize check + insert, including when separate sessions/workers race.
        with closing(sqlite3.connect(self.path)) as conn, conn:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute("DELETE FROM messages WHERE sent < ?", (min(minute, midnight.timestamp()),))
            day_count, = conn.execute("SELECT COUNT(*) FROM messages WHERE account=? AND sent>=?",
                                      (account, midnight.timestamp())).fetchone()
            retry_at = (midnight + timedelta(days=1)).timestamp() if day_count >= self.per_day else stamp
            count, oldest = conn.execute("SELECT COUNT(*), MIN(sent) FROM messages WHERE account=? AND sent>?",
                                         (account, minute)).fetchone()
            if count >= self.per_minute:
                retry_at = max(retry_at, oldest + 60)
            if retry_at > stamp:
                return math.ceil(retry_at - stamp)
            conn.execute("INSERT INTO messages VALUES (?, ?, ?)", (account, stamp, ip_tag))
            # Observe unusual traffic without penalizing a shared campus IP.
            ip_count, = conn.execute("SELECT COUNT(*) FROM messages WHERE ip_tag=? AND sent>?",
                                     (ip_tag, minute)).fetchone()
            if ip_count == self.ip_alert:
                log.warning("assistant_ip_burst messages=%d", ip_count)
        return 0
