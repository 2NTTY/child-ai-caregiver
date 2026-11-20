"""Run FHS operator jobs in one resource-limited container on the existing site VM."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys


CACHE = "/var/tmp/yuban-knowledge"
MEMORY_MIB = 512
FAMILY_HEADROOM_MIB = 384
SOURCE = re.compile(r"pdf-[a-f0-9]{24}")
HASH = re.compile(r"[a-f0-9]{64}")
SLOT = "/run/lock/yuyoufang-fhs-publication.lock"


def commands(args, manifest):
    if args.action == "lane":
        groups = {group["id"]: group["sources"] for group in manifest["lanes"]}
        sources = sorted(groups[args.lane], key=lambda source: source["pages"])
        if args.source:
            sources = [source for source in sources if source["sourceId"] == args.source]
        if not sources or any(not SOURCE.fullmatch(row["sourceId"]) for row in sources):
            raise ValueError("Invalid publication lane source")
        for row in sources:
            yield ["scripts/fhs-catalog-batch.mjs", "--lane", args.lane, args.mode, row["sourceId"]]
    elif args.action == "receipt":
        yield ["scripts/fhs-publication-receipt.mjs", args.source, args.original, *([args.delivery] if args.delivery else [])]
    elif args.action == "inspect":
        yield ["scripts/fhs-initial-campaign.mjs", "inspect", args.source]
    else:
        yield ["scripts/fhs-initial-campaign.mjs", "status"]


def compose_job(host, args, command):
    state = host.read(host.STATE)
    if host.JOURNAL.exists() or host.layout() != state["layout"]:
        raise RuntimeError("Site release or configuration change in progress")
    host.check_live(state["services"])
    if json.loads(host.url("/api/health")).get("status") != "ok":
        raise RuntimeError("Family site is not healthy")
    available_kib = int(re.search(r"^MemAvailable:\s+(\d+) kB$", Path("/proc/meminfo").read_text(), re.M)[1])
    if available_kib < (MEMORY_MIB + FAMILY_HEADROOM_MIB) * 1024:
        raise RuntimeError("Insufficient free memory for publication and the family site")
    volume, = [mount for mount in host.container("worker")["Mounts"] if mount["Destination"] == CACHE and mount["Type"] == "volume"]
    # Compose reuses the current worker configuration, including its file secret, on the same host.
    # Only this transient container receives the limits. The original worker volume stays read-only.
    service = {"image": state["services"]["worker"]["ref"], "cpus": 0.5, "mem_limit": f"{MEMORY_MIB}m",
               "memswap_limit": f"{MEMORY_MIB}m", "restart": "no", "volumes": [f"fhs_publication_cache:{CACHE}:ro"]}
    if args.reads:
        service["environment"] = {"FHS_CAMPAIGN_PDF_READS": args.reads, "FHS_CAMPAIGN_PDF_READS_SHA256": args.reads_hash}
    if args.action == "accounting":
        service.setdefault("environment", {})["FHS_CAMPAIGN_DAY_ADMISSION"] = "2026-11-20"
    overlay = {"services": {"worker": service}, "volumes": {"fhs_publication_cache": {"external": True, "name": volume["Name"]}}}
    layout = state["layout"]
    docker = ["docker", "compose", "--project-directory", layout["wd"], "-p", "yuban-p1", "--env-file", layout["env"]]
    for path in [*layout["files"], str(host.OVERRIDE), "-"]:
        docker.extend(["-f", path])
    docker.extend(["run", "-T", "--no-deps", "--rm", "--pull", "never", "--name", "yuban-fhs-publication",
                   "worker", "node", *command])
    # A lane may quarantine one source and still finish others. Keep the CLI's original
    # lane/source result separate from setup failures, OOMs and unconfirmed delivery.
    with subprocess.Popen(docker, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True) as process:
        process.stdin.write(json.dumps(overlay))
        process.stdin.close()
        last_state = None
        for line in process.stdout:
            print(line, end="", flush=True)
            if args.action == "lane" and line.startswith("{"):
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                if isinstance(row, dict) and row.get("lane") == args.lane and row.get("sourceId") == command[-1]:
                    last_state = row.get("state")
        return process.wait(), last_state


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
    sub.add_parser("inspect").add_argument("source")
    receipt = sub.add_parser("receipt")
    receipt.add_argument("source")
    receipt.add_argument("original")
    receipt.add_argument("delivery", nargs="?")
    args = parser.parse_args()
    if getattr(args, "source", None) and not SOURCE.fullmatch(args.source):
        parser.error("Invalid PDF source")
    if any(value and not HASH.fullmatch(value) for value in (getattr(args, "original", None), getattr(args, "delivery", None))):
        parser.error("Invalid original or delivery operation")
    if bool(args.reads) != bool(args.reads_hash) or args.reads and (
        not re.fullmatch(CACHE + r"/[a-zA-Z0-9_-]+", args.reads) or not HASH.fullmatch(args.reads_hash)
    ):
        parser.error("Provide the verified directory and index hash together")
    sys.path.insert(0, "/usr/local/lib/yuyoufang-site-release")
    import host
    manifest = None
    if args.action == "lane":
        manifest = json.loads(host.run(["docker", "exec", "yuban-p1-worker-1", "cat", "/app/knowledge/fhs-initial-publication-lanes.json"]))
    exit_code = 0
    for command in commands(args, manifest):
        # Waiting operators use only a small host process. Release the slot between sources.
        with open(SLOT, "a") as slot:
            fcntl.flock(slot, fcntl.LOCK_EX)
            result, state = compose_job(host, args, command)
        if result == 2 and state == "source_blocked":
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
