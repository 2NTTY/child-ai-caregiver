"""Prepare disabled P2 settings on an existing Linux P1 host; never rotate keys."""
import argparse
import base64
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import stat
import sys
from urllib.parse import urlsplit


PRIVATE = Path("/etc/yuban-p1")
ATTACHMENTS = Path("/var/lib/yuban-p1/attachments")
APP_OWNER = (1000, 1000)
ROOT_OWNER = (0, 0)
MAX_ENV_BYTES = 65536
MAX_JSON_BYTES = 2048
UPDATES = {
    "AI_ENABLED": "false",
    "P2_AGENT_ENABLED": "false",
    "WEB_PUSH_ENABLED": "false",
    "TELEGRAM_ENABLED": "false",
    "ATTACHMENTS_DIR": "/var/lib/yuban/attachments",
    "WEB_PUSH_VAPID_FILE": "/run/secrets/web_push_vapid",
    "TELEGRAM_CONFIG_FILE": "/run/secrets/telegram_config",
}


def require(condition):
    if not condition:
        raise ValueError("configuration_invalid")


def outside_checkout(path, checkout):
    require(path.is_absolute())
    for part in (path, *path.parents):
        try:
            require(not stat.S_ISLNK(part.lstat().st_mode))
        except FileNotFoundError:
            pass
    resolved = path.resolve()
    require(resolved != checkout and checkout not in resolved.parents)
    return resolved


def file_info(path, owner, limit):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1)
    require((info.st_uid, info.st_gid) == owner and stat.S_IMODE(info.st_mode) == 0o600)
    require(0 < info.st_size <= limit)
    return info


def read_private(path, owner, limit):
    expected = file_info(path, owner, limit)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        current = os.fstat(stream.fileno())
        require((current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns)
                == (expected.st_dev, expected.st_ino, expected.st_size, expected.st_mtime_ns))
        content = stream.read(limit + 1)
    require(len(content) == expected.st_size and len(content) <= limit)
    return content, expected


def directory_info(path, owner, mode=None):
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and (info.st_uid, info.st_gid) == owner)
    require(stat.S_IMODE(info.st_mode) == mode if mode is not None else not info.st_mode & 0o022)


def parse_env(content):
    require(0 < len(content) <= MAX_ENV_BYTES)
    text = content.decode("utf-8")
    require("\x00" not in text and "\r" not in text.replace("\r\n", ""))
    values = {}
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = re.fullmatch(r"([A-Z][A-Z0-9_]*)=(.*)", line)
        require(match is not None and match[1] not in values)
        values[match[1]] = match[2]
    return text, values


def prepare_env(content):
    text, values = parse_env(content)
    baseline = {
        "NODE_ENV": "production", "HOST": "0.0.0.0", "PORT": "3001",
        "STORAGE_KEY_FILE": "/run/secrets/storage_key", "VERTEX_LOCATION": "global",
        "GEMINI_MODEL": "gemini-3.1-flash-lite", "AI_DAILY_USER_ATTEMPTS": "5",
        "AI_DAILY_GLOBAL_ATTEMPTS": "20", "AI_MAX_ATTEMPTS": "1",
    }
    require(all(values.get(key) == value for key, value in baseline.items()))
    require(values.get("AI_ENABLED") in ("true", "false"))
    require(re.fullmatch(r"[a-f0-9]{64}", values.get("BETTER_AUTH_SECRET", "")) is not None)
    require(re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", values.get("GCP_PROJECT_ID", "")) is not None)
    db = urlsplit(values.get("DATABASE_URL", ""))
    require(db.scheme == "postgresql" and db.hostname == "postgres" and db.port == 5432
            and db.path == "/yuban" and db.username == "yuban" and db.password
            and not db.query and not db.fragment)
    origin = values.get("SERVER_ORIGIN", "")
    web = urlsplit(origin)
    require(origin == values.get("WEB_ORIGIN") and web.scheme == "https" and web.hostname
            and not web.username and not web.password and not web.path and not web.query and not web.fragment)
    newline = "\r\n" if "\r\n" in text else "\n"
    lines, seen = [], set()
    for line in text.splitlines(keepends=True):
        key = line.split("=", 1)[0]
        if key in UPDATES:
            ending = "\r\n" if line.endswith("\r\n") else "\n" if line.endswith("\n") else ""
            lines.append(key + "=" + UPDATES[key] + ending)
            seen.add(key)
        else:
            lines.append(line)
    updated = "".join(lines)
    if updated and not updated.endswith(("\n", "\r")):
        updated += newline
    updated += "".join(key + "=" + value + newline for key, value in UPDATES.items() if key not in seen)
    _, after = parse_env(updated.encode("utf-8"))
    require(all(after[key] == value for key, value in values.items() if key not in UPDATES))
    require(all(after[key] == value for key, value in UPDATES.items()))
    return updated.encode("utf-8")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result)
        result[key] = value
    return result


def url_bytes(value, length):
    require(re.fullmatch(r"[A-Za-z0-9_-]+", value) is not None)
    decoded = base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
    require(len(decoded) == length and base64.urlsafe_b64encode(decoded).decode("ascii").rstrip("=") == value)
    return decoded


def validate_json(content, kind):
    require(0 < len(content) <= MAX_JSON_BYTES)
    value = json.loads(content.decode("utf-8"), object_pairs_hook=unique_object)
    fields = {"token", "botId", "botUsername", "webhookSecret"} if kind == "telegram" else {"publicKey", "privateKey", "subject"}
    require(isinstance(value, dict) and set(value) == fields)
    require(all(isinstance(item, str) and item for item in value.values()))
    if kind == "telegram":
        require(re.fullmatch(r"[1-9][0-9]{0,15}:[A-Za-z0-9_-]{30,100}", value["token"]) is not None)
        require(re.fullmatch(r"[1-9][0-9]{0,15}", value["botId"]) is not None)
        require(value["token"].split(":")[0] == value["botId"])
        require(re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{1,28}bot", value["botUsername"], re.I) is not None)
        require(re.fullmatch(r"[A-Za-z0-9_-]{32,128}", value["webhookSecret"]) is not None)
    else:
        require(url_bytes(value["publicKey"], 65)[0] == 4)
        url_bytes(value["privateKey"], 32)
        subject = value["subject"]
        require(len(subject) <= 254 and re.search(r"[\s\x00-\x1f\x7f]", subject) is None)
        parsed = urlsplit(subject)
        require(parsed.scheme in ("https", "mailto") and not parsed.username and not parsed.password and not parsed.fragment)
        require(bool(parsed.hostname) if parsed.scheme == "https" else re.fullmatch(r"[^@/?#]+@[^@/?#]+", parsed.path) is not None)
        # The production Node reader additionally verifies the EC key pair before enabling Push.


def write_new(path, content, owner):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        os.fchown(stream.fileno(), *owner)
        os.fchmod(stream.fileno(), 0o600)
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


def configure(telegram_path, vapid_path):
    require(sys.platform.startswith("linux") and os.geteuid() == 0)
    checkout = Path(__file__).resolve().parents[2]
    outside_checkout(PRIVATE, checkout)
    outside_checkout(ATTACHMENTS, checkout)
    directory_info(PRIVATE, ROOT_OWNER, 0o700)
    for name, owner, limit in (
        ("server.env", ROOT_OWNER, MAX_ENV_BYTES), ("db_password", ROOT_OWNER, 128),
        ("storage.key", APP_OWNER, 128), ("backup.key", APP_OWNER, 128),
    ):
        path = outside_checkout(PRIVATE / name, checkout)
        file_info(path, owner, limit)
    original, original_info = read_private(PRIVATE / "server.env", ROOT_OWNER, MAX_ENV_BYTES)
    updated = prepare_env(original)
    installs = []
    for source, name, kind in ((telegram_path, "telegram.json", "telegram"), (vapid_path, "vapid.json", "vapid")):
        source = outside_checkout(Path(source), checkout)
        content, _ = read_private(source, ROOT_OWNER, MAX_JSON_BYTES)
        validate_json(content, kind)
        target = outside_checkout(PRIVATE / name, checkout)
        if target.exists():
            existing, _ = read_private(target, APP_OWNER, MAX_JSON_BYTES)
            require(existing == content)
        else:
            installs.append((target, content))
    directory_info(ATTACHMENTS.parent.parent, ROOT_OWNER)
    if ATTACHMENTS.parent.exists():
        directory_info(ATTACHMENTS.parent, ROOT_OWNER)
    if ATTACHMENTS.exists():
        directory_info(ATTACHMENTS, APP_OWNER, 0o700)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ") + "-" + str(os.getpid())
    backup = PRIVATE / ("server.env.before-p2-" + stamp)
    temporary = PRIVATE / (".server.env.p2-" + stamp + ".tmp")
    require(not backup.exists() and not backup.is_symlink() and not temporary.exists() and not temporary.is_symlink())
    # Validation above is complete; only new files/directories and the allowlisted env replacement follow.
    os.umask(0o077)
    write_new(backup, original, ROOT_OWNER)
    for path, content in installs:
        write_new(path, content, APP_OWNER)
    if not ATTACHMENTS.parent.exists():
        ATTACHMENTS.parent.mkdir(mode=0o700)
        os.chown(ATTACHMENTS.parent, *ROOT_OWNER)
    if not ATTACHMENTS.exists():
        ATTACHMENTS.mkdir(mode=0o700)
        os.chown(ATTACHMENTS, *APP_OWNER)
    write_new(temporary, updated, ROOT_OWNER)
    current = file_info(PRIVATE / "server.env", ROOT_OWNER, MAX_ENV_BYTES)
    require((current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns)
            == (original_info.st_dev, original_info.st_ino, original_info.st_size, original_info.st_mtime_ns))
    os.replace(temporary, PRIVATE / "server.env")
    directory_fd = os.open(PRIVATE, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def main():
    parser = argparse.ArgumentParser(description="Prepare disabled P2 settings without replacing existing P1 secrets.")
    parser.add_argument("--telegram-json", required=True, help="Absolute path to a root-owned 0600 JSON file outside the checkout.")
    parser.add_argument("--vapid-json", required=True, help="Absolute path to a root-owned 0600 JSON file outside the checkout.")
    args = parser.parse_args()
    try:
        configure(args.telegram_json, args.vapid_json)
    except Exception:
        print("configuration_preparation_failed_keep_existing_files", file=sys.stderr)
        raise SystemExit(1)
    print("prepared features_disabled")


if __name__ == "__main__":
    main()
