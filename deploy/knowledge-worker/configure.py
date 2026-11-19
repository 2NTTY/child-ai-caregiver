"""Enable or disable the platform-funded public knowledge worker on the existing Compose host."""
import argparse
import hashlib
import os
from pathlib import Path
import re
import stat
import sys
import tempfile

NAMES = {
    "AI_BACKGROUND_KNOWLEDGE_MAINTENANCE_ENABLED": "true",
    "AI_BACKGROUND_KNOWLEDGE_LIVE_FETCH": "true",
    "AI_BACKGROUND_KNOWLEDGE_LIVE_PUBLISH": "true",
    "AI_KNOWLEDGE_MAINTENANCE_PAYER": "platform",
}
BLOCK = ("\n# managed: public knowledge worker\n" + "".join(k + "=" + v + "\n" for k, v in NAMES.items())).encode()


def planned(before, enable):
    plain = before[:-len(BLOCK)] if before.endswith(BLOCK) else before
    if any(re.search(rb"(?m)^\s*(?:export\s+)?" + key.encode() + rb"\s*=", plain) for key in NAMES):
        raise ValueError("A separately managed knowledge setting exists; inspect its owner first")
    return plain + BLOCK if enable else plain


def durable_replace(path, content):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise ValueError("Unexpected protected settings file type")
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
        try:
            os.fchown(tmp.fileno(), info.st_uid, info.st_gid)
            os.fchmod(tmp.fileno(), stat.S_IMODE(info.st_mode))
            tmp.write(content)
            tmp.flush()
            os.fsync(tmp.fileno())
            os.replace(tmp.name, path)
        finally:
            Path(tmp.name).unlink(missing_ok=True)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def configure(host, revision, enable):
    state = host.read(host.STATE)
    if state["services"]["worker"]["sha"] != revision:
        raise ValueError("Running worker differs from the approved revision")
    journal = host.ROOT / "public-knowledge-config.json"
    if host.JOURNAL.exists() or (host.ROOT / "blocked.json").exists():
        raise RuntimeError("Resolve the active site release first")
    expected = state["layout"]
    path = Path(expected["env"]).with_name("firebase.env")
    layout = host.layout()
    before = path.read_bytes()
    after = planned(before, enable)
    desired = {**expected, "config": {**expected["config"], str(path): hashlib.sha256(after).hexdigest()}}
    intent = {"revision": revision, "enabled": enable, "desired": desired}
    resuming = journal.exists()
    if resuming and host.read(journal) != intent:
        raise RuntimeError("Resume the original public knowledge configuration change first")
    if layout != expected and (not journal.exists() or layout != desired):
        raise RuntimeError("Unexpected Compose configuration drift")
    if not resuming:
        host.health(state["services"], state["html"])
        host.idle()
    host.write(journal, intent)
    def applied():
        env = dict(entry.split("=", 1) for entry in host.container("worker")["Config"]["Env"] if "=" in entry)
        return all(env.get(key) == (value if enable else None) for key, value in NAMES.items())
    restart = ["up", "-d", "--no-deps", "--force-recreate", "--wait", "--wait-timeout", "90", "worker"]
    try:
        if after != before:
            durable_replace(path, after)
        if host.layout() != desired:
            raise RuntimeError("Unexpected Compose inputs after settings change")
        host.compose(state, ["config", "--quiet"])
        if not applied():
            host.compose(state, restart)
        if not applied():
            raise RuntimeError("Worker configuration did not take effect")
        host.health(state["services"], state["html"])
    except Exception:
        # Restore only this controlled suffix; a concurrent unrelated edit stays visible as drift.
        if host.layout() == desired and expected != desired:
            original = planned(after, not enable)
            if hashlib.sha256(original).hexdigest() == expected["config"][str(path)]:
                durable_replace(path, original)
                host.compose(state, restart)
                host.health(state["services"], state["html"])
                journal.unlink()
        raise
    state["layout"] = desired
    host.write(host.STATE, state)
    host.cloud_write("status/live.json", host.summary(state))
    journal.unlink()
    print("public knowledge maintenance " + ("enabled" if enable else "disabled") + " on " + revision)


if __name__ == "__main__":
    import fcntl
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["enable-platform", "disable"])
    parser.add_argument("revision")
    args = parser.parse_args()
    if not re.fullmatch("[0-9a-f]{40}", args.revision):
        parser.error("Provide the full running worker revision")
    sys.path.insert(0, "/usr/local/lib/yuyoufang-site-release")
    import host
    with open("/run/lock/yuyoufang-site-release.lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        configure(host, args.revision, args.mode == "enable-platform")
