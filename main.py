"""Local development entry point. Run `python main.py`."""
import os

from dotenv import load_dotenv

load_dotenv()
if os.getenv("DATA_SOURCE", "mock") == "backend":
    from cinema import create_app
else:
    from cinema_ai import create_app
app = create_app()

if __name__ == "__main__":
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "5001"))
    print(f"\nWebsite URL: http://{host}:{port}\n", flush=True)
    if os.getenv("CINEMA_DEV_SERVER", "").lower() in {"1", "true", "yes"}:
        app.run(host=host, port=port)
    else:
        from waitress import serve

        serve(app, host=host, port=port)
