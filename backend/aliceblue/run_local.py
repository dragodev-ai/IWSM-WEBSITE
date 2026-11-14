"""Local launch helper for the Alice Blue backend.

Reads backend/aliceblue.env if present (see USER_GUIDE.md); otherwise starts with
safe defaults so the service can boot for local UI development before credentials
are configured. Not for production use.
"""
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SP = HERE / ".venv" / "Lib" / "site-packages"
if SP.is_dir():
    sys.path.insert(0, str(SP))
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import uvicorn

from alice_service import PREFIX, create_app, ensure_session_key, settings

ROOT = HERE.parent.parent
folder = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "IWSM"
config = settings([
    folder / "aliceblue.env",
    ROOT / ".env",
    HERE / ".env",
])
config.setdefault("ALICEBLUE_APP_CODE", "")
config.setdefault("ALICEBLUE_API_SECRET", "")
config.setdefault(
    "ALICEBLUE_REDIRECT_URL", "http://127.0.0.1:4174" + PREFIX + "/auth/callback"
)
config["ALICEBLUE_SESSION_ENCRYPTION_KEY"] = ensure_session_key(folder, config)
app = create_app(
    config,
    str(folder / "aliceblue-sessions.sqlite3"),
    local_owner_mode=True,
    env_path=str(HERE / ".env"),
)
app.state.enable_prewarm = True

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=4180, access_log=False, log_level="warning")
