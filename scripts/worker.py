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
                    expired = expire_holds()
                    refunds = process_pending_refunds()
                    print(
                        f"Worker batch: expired={expired.get('processed', 0)} "
                        f"refunds_succeeded={refunds.get('succeeded', 0)} "
                        f"refunds_failed={refunds.get('failed', 0)}",
                        flush=True,
                    )
                except Exception as error:
                    app.logger.exception(
                        "Worker batch failed; next scheduled batch will retry"
                    )
                    print(
                        f"Worker batch failed: {type(error).__name__}",
                        flush=True,
                    )
                time.sleep(10)
    except KeyboardInterrupt:
        pass
    finally:
        app.extensions["db"].dispose()
