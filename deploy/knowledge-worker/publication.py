"""Run FHS operator jobs in one resource-limited container on the existing site VM."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
import time


CACHE = "/var/tmp/yuban-knowledge"
MAX_MEMORY_MIB = 512
FAMILY_HEADROOM_MIB = 384
LAUNCHER_HEADROOM_MIB = 64
HASH = re.compile(r"[a-f0-9]{64}")
SLOT = "/run/lock/yuyoufang-fhs-publication.lock"
# The release owner has one original deferred review outside the three assigned lanes.
CONTINUATION_SOURCE = "pdf-c79a394b580ec9e870d63319"


class OriginalCapacityError(RuntimeError):
    """The slot has room for ordinary work but not this PDF's native request."""


def commands(args, manifest):
    if args.action == "accounting":
        yield ["scripts/fhs-initial-campaign.mjs", "status"]
        return
    if args.action == "script":
        if args.reads or not any(row["sourceId"] == args.source and row["observationHash"] == args.observation for row in manifest):
            raise ValueError("Unassigned script edition")
        verb = "publish-script-edition" if args.mode == "run" else "inspect-script-edition"
        yield ["scripts/fhs-initial-campaign.mjs", verb, args.source, args.observation]
        return
    groups = {group["id"]: group["sources"] for group in manifest["lanes"]}
    if args.action == "lane":
        sources = sorted(groups[args.lane], key=lambda source: source["pages"])
        if args.source:
            sources = [source for source in sources if source["sourceId"] == args.source]
        if not sources:
            raise ValueError("Invalid publication lane source")
        for row in sources:
            yield ["scripts/fhs-catalog-batch.mjs", "--lane", args.lane, args.mode, row["sourceId"]]
        return
    if args.source != CONTINUATION_SOURCE and not any(
        row["sourceId"] == args.source for sources in groups.values() for row in sources
    ):
        raise ValueError("Unassigned publication source")
    if args.action == "receipt":
        yield ["scripts/fhs-publication-receipt.mjs", args.source, args.original, *([args.delivery] if args.delivery else [])]
    else:
        yield ["scripts/fhs-initial-campaign.mjs", "inspect", args.source]


def checked_site(host):
    state = host.read(host.STATE)
    if host.JOURNAL.exists() or host.layout() != state["layout"]:
        raise RuntimeError("Site release or configuration change in progress")
    host.check_live(state["services"])
    if json.loads(host.url("/api/health")).get("status") != "ok":
        raise RuntimeError("Family site is not healthy")
    return state


def capacity_for_phase(host, state, pdf_bytes):
    # The native request can hold PDF bytes, base64 and its serialized JSON concurrently.
    # Keep the existing maximum for exceptionally large originals, before any paid dispatch.
    minimum = MAX_MEMORY_MIB if pdf_bytes >= 32 * 1048576 else max(256, 224 + (4 * pdf_bytes + 1048575) // 1048576)
    reserve = FAMILY_HEADROOM_MIB + LAUNCHER_HEADROOM_MIB
    required = reserve + (minimum + 15) // 16 * 16
    waiting_since = None
    large_wait_since = None
    recheck_site = False
    while True:
        if host.JOURNAL.exists():
            raise RuntimeError("Site release in progress")
        available = int(re.search(r"^MemAvailable:\s+(\d+) kB$", Path("/proc/meminfo").read_text(), re.M)[1]) // 1024
        if available >= required:
            if recheck_site:
                live = checked_site(host)
                if live["layout"] != state["layout"] or live["services"]["worker"]["ref"] != state["services"]["worker"]["ref"]:
                    raise RuntimeError("Site release or worker configuration changed while waiting")
                recheck_site = False
                continue  # Read memory again after the health checks.
            if waiting_since is not None:
                print(f"publication_resumed_after_seconds={time.monotonic() - waiting_since:.1f}", file=sys.stderr, flush=True)
            return available, min(MAX_MEMORY_MIB, (available - reserve) // 16 * 16)
        now = time.monotonic()
        if available >= reserve + 256:
            # Other originals fit. Allow a brief fluctuation of one allocation quantum, then give them the slot.
            if large_wait_since is None:
                large_wait_since = now
            if required - available > 16 or now - large_wait_since >= 30:
                raise OriginalCapacityError(f"Insufficient free memory: {available} MiB available, {minimum} MiB job, "
                                            f"{FAMILY_HEADROOM_MIB} MiB family and {LAUNCHER_HEADROOM_MIB} MiB launcher required")
        else:
            large_wait_since = None
        if waiting_since is None:
            waiting_since = now
            print(f"publication_wait_available_mib={available} publication_required_mib={required}", file=sys.stderr, flush=True)
        recheck_site = True
        time.sleep(5)


def compose_job(host, args, command, *, original=None, pdf_bytes=0):
    state = checked_site(host)
    available, memory = capacity_for_phase(host, state, pdf_bytes)
    volume, = [mount for mount in host.container("worker")["Mounts"] if mount["Destination"] == CACHE and mount["Type"] == "volume"]
    # Compose reuses the current worker configuration, including its file secret, on the same host.
    # Only this transient container receives the limits. The original worker volume stays read-only.
    service = {"image": state["services"]["worker"]["ref"], "cpus": 0.5, "mem_limit": f"{memory}m",
               "memswap_limit": f"{memory}m", "restart": "no", "healthcheck": {"disable": True},
               "volumes": [f"fhs_publication_cache:{CACHE}:ro"]}
    if args.reads:
        service["environment"] = {"FHS_CAMPAIGN_PDF_READS": args.reads, "FHS_CAMPAIGN_PDF_READS_SHA256": args.reads_hash}
    if original:
        service.setdefault("environment", {}).update(FHS_CAMPAIGN_LANE=args.lane, FHS_CAMPAIGN_ORIGINAL_OPERATION=original)
    if args.action == "accounting":
        service.setdefault("environment", {})["FHS_CAMPAIGN_DAY_ADMISSION"] = "2026-11-20"
    overlay = {"services": {"worker": service}, "volumes": {"fhs_publication_cache": {"external": True, "name": volume["Name"]}}}
    layout = state["layout"]
    docker = ["docker", "compose", "--project-directory", layout["wd"], "-p", "yuban-p1", "--env-file", layout["env"]]
    for path in [*layout["files"], str(host.OVERRIDE), "-"]:
        docker.extend(["-f", path])
    # The tiny shell survives Node's exit and reads the kernel high-water mark before Docker removes the cgroup.
    probe = 'node "$@"; rc=$?; if read -r peak < /sys/fs/cgroup/memory.peak; then echo "publication_peak_bytes=$peak" >&2; fi; exit "$rc"'
    docker.extend(["run", "-T", "--no-deps", "--rm", "--pull", "never", "--name", "yuban-fhs-publication",
                   "worker", "sh", "-c", probe, "publication", *command])
    print(f"publication_available_mib={available} publication_limit_mib={memory}", file=sys.stderr, flush=True)
    # A lane may quarantine one source and still finish others. Keep the CLI's original
    # lane/source result separate from setup failures, OOMs and unconfirmed delivery.
    with subprocess.Popen(docker, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True) as process:
        process.stdin.write(json.dumps(overlay))
        process.stdin.close()
        last_state = None
        for line in process.stdout:
            print(line, end="", flush=True)
            if args.action == "lane" and command[0] == "scripts/fhs-catalog-batch.mjs" and line.startswith("{"):
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                if isinstance(row, dict) and row.get("lane") == args.lane and row.get("sourceId") == command[-1]:
                    last_state = row
        return process.wait(), last_state


def run_source(host, args, command, pdf_bytes):
    if args.action != "lane" or args.mode != "run":
        code, row = compose_job(host, args, command)
        return code, row and row.get("state")
    # Each phase exits before the next opens its Firestore client. Hold the host lock through terminal readback.
    source = command[-1]
    prefix = command[:3]
    code, ready = compose_job(host, args, [*prefix, "prepare", source])
    state = ready and ready.get("state")
    if code or state in ("held", "published"):
        return code, state
    op = ready and ready.get("operationFingerprint")
    if state != "ready" or ready.get("pinned") is not True or not isinstance(op, str) or not HASH.fullmatch(op):
        raise RuntimeError("Publication requires the prepared original operation")
    if ready.get("started") is True:
        publish = ["resume-approved", source, op]
    elif ready.get("started") is False:
        publish = ["publish-approved", source]
    else:
        raise RuntimeError("Unknown start state for the prepared operation")
    try:
        code, _ = compose_job(host, args, ["scripts/fhs-initial-campaign.mjs", *publish], original=op, pdf_bytes=pdf_bytes)
    except OriginalCapacityError as error:
        print(json.dumps({"lane": args.lane, "sourceId": source, "state": "capacity_wait", "reason": str(error)}), flush=True)
        return 2, "capacity_wait"
    checked, after = compose_job(host, args, [*prefix, "status", source])
    if checked or not after or after.get("operationFingerprint") != op:
        raise RuntimeError("Unable to confirm the original operation after dispatch")
    state = after.get("state")
    if state in ("published", "held"):
        return 0, state
    if code >= 125 or code < 0:
        raise RuntimeError(f"Publication process exited abnormally ({code}); original operation state: {state}")
    if state == "source_blocked":
        return 2, state
    if code not in (0, 3):
        return code, state
    raise RuntimeError("Missing terminal publication receipt")


def main():
    import fcntl
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reads", help="Verified reads directory on the worker volume")
    parser.add_argument("--reads-hash", help="SHA-256 of the verified reads index")
    sub = parser.add_subparsers(dest="action", required=True)
    lane = sub.add_parser("lane")
    lane.add_argument("lane", choices=["C1", "C2", "C3"])
    lane.add_argument("mode", choices=["status", "prepare", "run"])
    lane.add_argument("source", nargs="?")
    sub.add_parser("accounting")
    script = sub.add_parser("script")
    script.add_argument("mode", choices=["inspect", "run"])
    script.add_argument("source")
    script.add_argument("observation")
    sub.add_parser("inspect").add_argument("source")
    receipt = sub.add_parser("receipt")
    receipt.add_argument("source")
    receipt.add_argument("original")
    receipt.add_argument("delivery", nargs="?")
    args = parser.parse_args()
    if any(value and not HASH.fullmatch(value) for value in (getattr(args, "original", None), getattr(args, "delivery", None))):
        parser.error("Invalid original or delivery operation")
    if bool(args.reads) != bool(args.reads_hash) or args.reads and (
        not re.fullmatch(CACHE + r"/[a-zA-Z0-9_-]+", args.reads) or not HASH.fullmatch(args.reads_hash)
    ):
        parser.error("Provide the verified directory and index hash together")
    sys.path.insert(0, "/usr/local/lib/yuyoufang-site-release")
    import host
    manifest = None
    byte_sizes = {}
    if args.action == "script":
        if not HASH.fullmatch(args.observation) or not re.fullmatch(r"fhs-[0-9]{5}", args.source):
            parser.error("Invalid script source or observation")
        manifest = json.loads(host.run(["docker", "exec", "yuban-p1-worker-1", "cat", "/app/knowledge/fhs-script-editions.json"]))
    elif args.action != "accounting":
        manifest = json.loads(host.run(["docker", "exec", "yuban-p1-worker-1", "cat", "/app/knowledge/fhs-initial-publication-lanes.json"]))
    if args.action == "lane" and args.mode == "run":
        inventory = json.loads(host.run(["docker", "exec", "yuban-p1-worker-1", "cat", "/app/knowledge/fhs-child-inventory.json"]))
        originals = {pdf["sha256"]: pdf["bytes"] for pdf in inventory["pdfOriginals"]}
        byte_sizes = {row["sourceId"]: originals[row["sha256"]] for group in manifest["lanes"] for row in group["sources"]}
    exit_code = 0
    for command in commands(args, manifest):
        # Waiting operators use only a small host process. Release the slot between sources.
        with open(SLOT, "a") as slot:
            fcntl.flock(slot, fcntl.LOCK_EX)
            result, state = run_source(host, args, command, byte_sizes[command[-1]] if byte_sizes else 0)
        if result == 2 and state in ("source_blocked", "capacity_wait"):
            exit_code = result
            continue
        if result:
            return result
    return exit_code


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, RuntimeError, ValueError) as error:
        sys.exit(str(error))
