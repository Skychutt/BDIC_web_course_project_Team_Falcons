"""Run regression tests using disposable schemas on this project's private MySQL."""
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import quote

root = Path(__file__).resolve().parents[1]
socket = root / "instance/mysql/mysql.sock"
if not socket.exists():
    raise SystemExit("Start the isolated server first: python scripts/local_mysql.py start")
env = os.environ.copy()
env["TEST_DATABASE_URL"] = "mysql+pymysql://root@localhost/?charset=utf8mb4&unix_socket=" + quote(str(socket), safe="")
# Tests explicitly select mock or backend. Never leak a local model key into tests.
env.update(AI_PROVIDER="stub", DATA_SOURCE="mock", DEEPSEEK_API_KEY="", AMAP_JS_KEY="", AMAP_SECURITY_CODE="")
raise SystemExit(subprocess.call([sys.executable, "-m", "pytest", *(sys.argv[1:] or ["-q"])], cwd=root, env=env))
