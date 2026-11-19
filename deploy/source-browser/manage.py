"""Operate the source renderer from a root-owned, master-installed site bundle."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys

sys.path.insert(0, "/usr/local/lib/yuyoufang-site-release")
import host
from protocol import DIGEST, REPO, REV, host_version

PROJECT = "yuban-source-browser"
NAME = PROJECT + "-source-browser-1"
VOLUME = "yuban-p1_source-browser-ipc"
FLOOR = 3 * 1024**3
RAM = 384 * 1024**2
ACTIVE = host.ROOT/"source-browser.json"
PENDING = host.ROOT/"source-browser-pending.json"
EMPTY = {"current": None, "previous": None}
BUNDLE = Path(__file__).resolve().parent.parent
PROBE = """const http=require('node:http');
const r=http.get({socketPath:'/run/source-browser/render.sock',path:'/healthz'},res=>{
let body='';res.on('data',c=>body+=c);res.on('end',()=>{
if(res.statusCode!==200||!['ready','busy'].includes(body))process.exit(1);console.log(body);});});
r.setTimeout(2500,()=>r.destroy());r.on('error',()=>process.exit(1));"""

def state():
    return host.read(ACTIVE) if ACTIVE.exists() else dict(EMPTY)

def fingerprint(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def candidate(revision, digest, cold):
    if not REV.fullmatch(revision) or not DIGEST.fullmatch(digest) or cold <= 0:
        raise ValueError("Expected exact revision, registry digest and measured cold bytes")
    files = host.browser_bundle(revision)
    return {"revision": revision, "digest": digest, "coldBytes": cold,
            "mountHash": fingerprint(files/"p1/compose.firestore.source-browser.yaml"),
            "composeHash": fingerprint(files/"source-browser/compose.yaml"),
            "seccompHash": fingerprint(files/"source-browser/seccomp.json")}

def image_ref(spec):
    return REPO+"source-browser@"+spec["digest"]

def image(spec):
    ref = image_ref(spec)
    info = host.image_info(ref)
    if (ref not in (info.get("RepoDigests") or []) or info["Os"] != "linux" or info["Architecture"] != "amd64"
            or info["Config"]["Labels"].get("org.opencontainers.image.revision") != spec["revision"]):
        raise RuntimeError("Renderer registry digest, platform or revision differs")
    return info

def capacity():
    data_root = host.run(["docker", "info", "--format", "{{.DockerRootDir}}"])
    available = next(int(line.split()[1])*1024 for line in Path("/proc/meminfo").read_text().splitlines()
                     if line.startswith("MemAvailable:"))
    return {"receiverFreeBytes": shutil.disk_usage(host.ROOT).free,
            "dockerFreeBytes": shutil.disk_usage(data_root).free, "availableMemoryBytes": available}

def headroom(extra=0):
    free = capacity()
    if min(free["receiverFreeBytes"], free["dockerFreeBytes"]) < FLOOR+extra:
        raise RuntimeError("Insufficient disk for the measured candidate and the 3 GiB receiver floor")
    if free["availableMemoryBytes"] < RAM:
        raise RuntimeError("Less than 384 MiB of available memory")

def require_bundle(spec):
    if spec != candidate(spec["revision"], spec["digest"], spec["coldBytes"]):
        raise RuntimeError("Renderer bundle fingerprints changed")

def stage(spec):
    require_bundle(spec)
    ref = image_ref(spec)
    # Inspect the exact digest. A missing candidate always reserves its full cold size.
    try:
        host.image_info(ref)
    except RuntimeError:
        headroom(spec["coldBytes"])
        host.pull("source-browser", spec["digest"], spec["revision"])
    image(spec)
    headroom()

def sidecar(spec, args):
    require_bundle(spec)
    folder = host.browser_bundle(spec["revision"])/"source-browser"
    host.run(["env", "SOURCE_BROWSER_IMAGE="+image_ref(spec), "SOURCE_BROWSER_IPC_VOLUME="+VOLUME,
              "docker", "compose", "--env-file", "/dev/null", "--project-directory", str(folder),
              "-p", PROJECT, "-f", str(folder/"compose.yaml"), *args], timeout=140)

def renderer_exists():
    return bool(host.run(["docker", "ps", "-aq", "--filter", "name=^/"+NAME+"$"]))

def mount(worker):
    return [m for m in worker.get("Mounts", []) if m["Destination"] == "/run/source-browser"]

def correct_mount(mounts, writable):
    return (len(mounts) == 1 and mounts[0]["Type"] == "volume" and mounts[0]["Name"] == VOLUME
            and mounts[0]["RW"] is writable)

def probe(container):
    return host.run(["docker", "exec", "-u", "1000:1000", container, "node", "-e", PROBE], timeout=8)

def verify_renderer(spec):
    r = json.loads(host.run(["docker", "inspect", NAME]))[0]
    cfg = r["HostConfig"]
    if (r["Image"] != image(spec)["Id"] or r["State"]["Health"]["Status"] != "healthy"
            or r["Config"]["User"] != "1000:1000" or cfg["NetworkMode"] != "none"
            or not cfg["ReadonlyRootfs"] or cfg["Memory"] != RAM or cfg["MemorySwap"] != RAM
            or not correct_mount(mount(r), True)):
        raise RuntimeError("Renderer isolation, health or live image differs")
    return probe(NAME)

def rollback_identity(spec):
    if renderer_exists():
        live = json.loads(host.run(["docker", "inspect", NAME]))[0]
        if (live["Config"]["Labels"].get("com.docker.compose.project") != PROJECT
                or live["Image"] != image(spec)["Id"]):
            raise RuntimeError("Unexpected renderer identity; inspect the existing container")

def verify(site, spec):
    host.check_live(site["services"], browser_mounted=bool(spec))
    if spec:
        require_bundle(spec)
        verify_renderer(spec)
        probe("yuban-p1-worker-1")
    elif mount(host.container("worker")) or renderer_exists():
        raise RuntimeError("Unexpected renderer or worker socket mount")

def ensure_volume():
    # A Compose external volume may already exist after an interrupted first install.
    host.run(["docker", "volume", "create", VOLUME])
    info = json.loads(host.run(["docker", "volume", "inspect", VOLUME]))[0]
    if info["Driver"] != "local" or info.get("Options") or info.get("Scope") != "local":
        raise RuntimeError("Unexpected source browser IPC volume configuration")

def converge(site, desired, other):
    if desired:
        image(desired)
        ensure_volume()
        sidecar(desired, ["up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "60", "source-browser"])
        verify_renderer(desired)
    # Rebuild the same override that daily deployment and rollback regenerate.
    host.set_images(site["services"], browser=desired or False)
    host.compose(site, ["config", "--quiet"])
    # Compose is idempotent even when an interrupted worker recreation left no container.
    # Only attach/detach requires touching the worker. Digest-only rotations keep it running.
    if (desired or {}).get("mountHash") != (other or {}).get("mountHash"):
        host.compose(site, ["up", "-d", "--no-build", "--pull", "never", "--no-deps",
                            "--wait", "--wait-timeout", "120", "worker"])
    if not desired and other:
        sidecar(other, ["down"])
    verify(site, desired)

def baseline():
    if host.JOURNAL.exists() or (host.ROOT/"blocked.json").exists():
        raise RuntimeError("Resolve the existing site release before managing the renderer")
    site = host.read(host.STATE)
    if host.layout() != site["layout"]:
        raise RuntimeError("Production Compose baseline changed")
    return site

def retire(before, after):
    old = before.get("previous")
    retained = {s["digest"] for s in (after["current"], after["previous"]) if s}
    if old and old["digest"] not in retained:
        try:
            host.run(["docker", "image", "rm", image_ref(old)])
        except RuntimeError:
            print("Retained referenced renderer image "+image_ref(old), file=sys.stderr)

def recover(site):
    if not PENDING.exists():
        return
    transaction = host.read(PENDING)
    before, after = transaction["before"], transaction["after"]
    live = state()
    if live == after:
        # The commit was acknowledged on disk. A later service failure must still
        # allow an explicit rollback by digest, even if the final journal unlink was lost.
        retire(before, after)
        PENDING.unlink()
        verify(site, after["current"])
        return
    elif live == before:
        host.idle()
        if transaction.get("rollback"):
            # An explicitly selected rollback can start with a dead renderer. Restore
            # its retained target even if the operator lost the acknowledgement.
            converge(site, after["current"], before["current"])
            host.write(ACTIVE, after)
        else:
            converge(site, before["current"], after["current"])
    else:
        raise RuntimeError("The renderer journal and committed state disagree")
    PENDING.unlink()

def switch(site, before, after, *, rollback=False):
    host.idle()
    if before["current"]:
        try:
            activity = probe(NAME)
        except RuntimeError:
            if not rollback:
                raise
            activity = None
        if activity == "busy":
            raise RuntimeError("The current render is still running")
    host.write(PENDING, {"before": before, "after": after, "rollback": rollback})
    try:
        converge(site, after["current"], before["current"])
        host.write(ACTIVE, after)
    except Exception:
        recover(site)
        raise
    retire(before, after)
    PENDING.unlink()

def operate(args):
    site = baseline()
    if args.action == "recover":
        recover(site)
    if PENDING.exists():
        raise RuntimeError("Run recover on the existing renderer journal first")
    current = state()
    starting_rollback = args.action == "rollback" and current.get("rolledBackFrom") != args.digest
    if starting_rollback:
        host.check_live(site["services"])
    else:
        verify(site, current["current"])
    if args.action == "apply":
        spec = candidate(args.revision, args.digest, args.cold_bytes)
        if current["current"] and current["current"]["digest"] == spec["digest"] and current["current"] != spec:
            raise RuntimeError("Existing digest has a different receipt; use the original receipt")
        if current["current"] != spec:
            if current["current"]:
                image(current["current"])
            stage(spec)
            switch(site, current, {"current": spec, "previous": current["current"]})
    elif args.action == "rollback":
        if not DIGEST.fullmatch(args.digest):
            raise ValueError("Expected the current renderer digest for rollback")
        if current.get("rolledBackFrom") != args.digest:
            if not current["current"] or current["current"]["digest"] != args.digest:
                raise RuntimeError("Rollback baseline changed")
            rollback_identity(current["current"])
            if current["previous"]:
                require_bundle(current["previous"])
                image(current["previous"])
            switch(site, current, {"current": current["previous"], "previous": current["current"],
                                   "rolledBackFrom": args.digest}, rollback=True)
    return {"renderer": state(), "siteRelease": site["releaseId"], **capacity()}

def main():
    parser = argparse.ArgumentParser()
    actions = parser.add_subparsers(dest="action", required=True)
    for name in ("status", "recover"):
        actions.add_parser(name)
    apply = actions.add_parser("apply")
    apply.add_argument("revision")
    apply.add_argument("digest")
    apply.add_argument("cold_bytes", type=int)
    actions.add_parser("rollback").add_argument("digest")
    args = parser.parse_args()
    if os.geteuid() or BUNDLE != host.browser_bundle(BUNDLE.parent.name):
        raise RuntimeError("Use the root-owned bundle installed from master")
    with open("/run/lock/yuyoufang-site-release-install.lock", "a") as installer, \
            open("/run/lock/yuyoufang-site-release.lock", "a") as receiver:
        fcntl.flock(installer, fcntl.LOCK_EX)
        fcntl.flock(receiver, fcntl.LOCK_EX)
        if host_version(BUNDLE/"site-release") != host_version(host.HERE):
            raise RuntimeError("Installed receiver must match this operator bundle")
        if args.action == "apply" and args.revision != BUNDLE.parent.name:
            raise RuntimeError("Candidate must match the installed source bundle")
        print(json.dumps(operate(args), sort_keys=True))

if __name__ == "__main__":
    main()
