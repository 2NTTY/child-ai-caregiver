"""Wire contract shared by the producer and the single production receiver."""
import hashlib
import json
import re
from datetime import datetime, timezone

PROJECT = "ai-caregivers-for-children"
ZONE = "asia-east2-a"
VM = "yuban-p1"
ORIGIN = "https://ex-machina.eu.org"
BUCKET = PROJECT + "-site-release"
REPO = "asia-east2-docker.pkg.dev/" + PROJECT + "/site-release/"
SERVICES = ("api", "worker", "web")
DIGEST = re.compile(r"sha256:[a-f0-9]{64}\Z")
REV = re.compile(r"[a-f0-9]{40}\Z")
RUN = re.compile(r"r[1-9][0-9]{0,19}-[1-9][0-9]{0,3}\Z")

def now():
    return datetime.now(timezone.utc)

def stamp():
    return now().isoformat(timespec="seconds")

def parse_time(value):
    t = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if t.tzinfo is None:
        raise ValueError("Timestamp must have an offset")
    return t

def check_services(services):
    if not isinstance(services, dict) or set(services) != set(SERVICES):
        raise ValueError("Expected API, worker and Web revisions")
    for service in services.values():
        if set(service) != {"sha", "digest"} or not REV.fullmatch(service["sha"]) or not DIGEST.fullmatch(service["digest"]):
            raise ValueError("Invalid service identity")
    if services["api"] != services["worker"]:
        raise ValueError("API and worker must share a compatible backend image")

def check_command(command, clock=None):
    clock = clock or now()
    if set(command) != {"schema","id","operation","target","baseline","images","issuedAt","expiresAt","rollbackId","controlGeneration","hostVersion"}:
        raise ValueError("Unsupported release manifest")
    if command["schema"] != 1 or not RUN.fullmatch(command["id"]) or not REV.fullmatch(command["target"]):
        raise ValueError("Invalid release identity")
    if not re.fullmatch("[0-9]+", command["controlGeneration"]) or not re.fullmatch("[0-9a-f]{64}", command["hostVersion"]):
        raise ValueError("Invalid operator generation")
    start, end = parse_time(command["issuedAt"]), parse_time(command["expiresAt"])
    if not 0 < (end-start).total_seconds() <= 1800 or not start.timestamp()-60 <= clock.timestamp() < end.timestamp():
        raise ValueError("Expired or future release command")
    check_services(command["baseline"])
    images = command["images"]
    if command["operation"] == "rollback":
        if images or not re.fullmatch(r"(baseline-[a-f0-9]{12}|r[1-9][0-9]{0,19}-[1-9][0-9]{0,3})", command["rollbackId"] or ""):
            raise ValueError("Invalid rollback candidate")
    elif command["operation"] == "run":
        if command["rollbackId"] is not None or not images or set(images) - {"web","backend"}:
            raise ValueError("Invalid release components")
        for digest in images.values():
            if not DIGEST.fullmatch(digest):
                raise ValueError("Expected immutable registry digest")
    else:
        raise ValueError("Unsupported release operation")

def host_version(directory):
    digest = hashlib.sha256()
    for name in ("protocol.py", "store.py", "host.py", "activity.sh", "site-release.service", "site-release.timer"):
        digest.update(name.encode() + b"\0" + (directory/name).read_bytes().replace(b"\r\n", b"\n") + b"\0")
    return digest.hexdigest()
