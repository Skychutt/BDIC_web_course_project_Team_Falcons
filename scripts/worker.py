"""Local worker: expiry and wallet refund batches, with graceful Ctrl-C shutdown."""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cinema import create_app
from cinema.booking import expire_holds
from cinema.management import process_pending_refunds

app = create_app()
if __name__ == "__main__":
    try:
        with app.app_context():
            while True:
                try:
                    expire_holds()
                    process_pending_refunds()
                except Exception:
                    app.logger.exception(
                        "Worker batch failed; next scheduled batch will retry"
                    )
                time.sleep(10)
    except KeyboardInterrupt:
        pass
    finally:
        app.extensions["db"].dispose()
