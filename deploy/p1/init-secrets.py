"""Initialize new Linux-only pilot secrets outside the checkout; never overwrite."""
import argparse
import base64
import os
from pathlib import Path
import re
import secrets

parser = argparse.ArgumentParser()
parser.add_argument("--directory", required=True)
parser.add_argument("--backup-directory", required=True)
parser.add_argument("--host", required=True)
parser.add_argument("--project", required=True)
args = parser.parse_args()
try:
    if os.name != "posix" or os.geteuid() != 0:
        raise ValueError()
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]*\.[a-z]{2,}", args.host):
        raise ValueError()
    if not re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", args.project):
        raise ValueError()
    checkout = Path(__file__).resolve().parents[2]
    private = Path(args.directory)
    backup = Path(args.backup_directory)
    for path in (private, backup):
        if not path.is_absolute() or path.exists() or path.is_symlink():
            raise ValueError()
        resolved = path.resolve()
        if resolved == checkout or checkout in resolved.parents or not path.parent.is_dir():
            raise ValueError()
    if private.resolve() == backup.resolve() or private.resolve() in backup.resolve().parents or backup.resolve() in private.resolve().parents:
        raise ValueError()
    os.umask(0o077)
    private.mkdir(mode=0o700)
    backup.mkdir(mode=0o700)
    os.chown(backup, 1000, 1000)
    db_password = secrets.token_hex(32)
    values = {
        "db_password": db_password,
        "storage.key": base64.b64encode(secrets.token_bytes(32)).decode("ascii"),
        "backup.key": base64.b64encode(secrets.token_bytes(32)).decode("ascii"),
        "server.env": "\n".join([
            "NODE_ENV=production", "HOST=0.0.0.0", "PORT=3001",
            "DATABASE_URL=postgresql://yuban:" + db_password + "@postgres:5432/yuban",
            "BETTER_AUTH_SECRET=" + secrets.token_hex(32),
            "SERVER_ORIGIN=https://" + args.host, "WEB_ORIGIN=https://" + args.host,
            "STORAGE_KEY_FILE=/run/secrets/storage_key", "AI_ENABLED=false",
            "GCP_PROJECT_ID=" + args.project, "VERTEX_LOCATION=global",
            "GEMINI_MODEL=gemini-3.1-flash-lite", "AI_DAILY_USER_ATTEMPTS=5",
            "AI_DAILY_GLOBAL_ATTEMPTS=20", "AI_MAX_ATTEMPTS=1", "AI_TIMEOUT_MS=30000",
            "AI_MAX_INPUT_CHARACTERS=6000", "AI_MAX_OUTPUT_TOKENS=512",
        ]),
    }
    for name, value in values.items():
        target = private / name
        with target.open("x", encoding="utf-8", newline="") as stream:
            stream.write(value + "\n")
        target.chmod(0o600)
        if name.endswith(".key"):
            os.chown(target, 1000, 1000)
    print("production_secret_files_created")
except Exception:
    # Partial initialization remains for operator inspection; never silently replace keys.
    print("production_secret_setup_failed_keep_existing_files", file=__import__("sys").stderr)
    raise SystemExit(1)
