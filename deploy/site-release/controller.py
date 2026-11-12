"""GitHub-side release control. No SSH credentials or production application data."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from datetime import timedelta
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from protocol import (BUCKET, ORIGIN, PROJECT, REPO, RUN, VM, ZONE, check_command, check_services,
                      host_version, now, parse_time, stamp)
from store import Client

HERE=Path(__file__).resolve().parent
REPOSITORY="2NTTY/child-ai-caregiver"

def call(*args):
    return subprocess.check_output(list(args),text=True).strip()

def api(url, headers=None):
    with urlopen(Request(url,headers=headers or {}),timeout=15) as res:
        return json.load(res)

def readfile(name):
    return json.loads(Path(name).read_text())

def save(name, data):
    Path(name).write_text(json.dumps(data,ensure_ascii=False))

def output(key,value):
    if "\n" in str(value) or "\r" in str(value):
        raise ValueError("Invalid workflow output")
    with open(os.environ["GITHUB_OUTPUT"],"a") as f: f.write(f"{key}={value}\n")

def run_id():
    result="r"+os.environ["GITHUB_RUN_ID"]+"-"+os.environ["GITHUB_RUN_ATTEMPT"]
    if not RUN.fullmatch(result): raise ValueError("Invalid GitHub run identity")
    return result

def last_schedule():
    url="https://api.github.com/repos/"+REPOSITORY+"/actions/workflows/site-release.yml/runs?event=schedule&branch=master&per_page=1"
    runs=api(url,{"Authorization":"Bearer "+os.environ["GH_TOKEN"]})["workflow_runs"]
    return runs[0]["created_at"] if runs else None

def observe():
    client=Client(BUCKET)
    control=client.read_version("control/mode.json")
    live=client.read_version("status/live.json")["value"]
    if not live: raise RuntimeError("Install host receiver and adopt existing services before release")
    check_services(live["services"])
    vm=api(f"https://compute.googleapis.com/compute/v1/projects/{PROJECT}/zones/{ZONE}/instances/{VM}?fields=status,scheduling(terminationTime)",
           {"Authorization":"Bearer "+os.environ["SITE_ACCESS_TOKEN"]})
    state={**live,"hostObservedAt":live["observedAt"],"observedAt":stamp(),"vm":{"status":vm["status"],"terminationTime":vm.get("scheduling",{}).get("terminationTime")},
           "paused":bool((control["value"] or {}).get("paused",False)),"controlGeneration":control["generation"],
           "lastScheduledAt":last_schedule(),"lastResult":"observed"}
    expires=state["vm"]["terminationTime"]
    if expires:
        days=(parse_time(expires)-now()).total_seconds()/86400
        state["expiryWarningDays"]=1 if days<=1 else 7 if days<=7 else None
    return state

def plan():
    state=observe()
    target=os.environ["GITHUB_SHA"]
    state["sourceSha"]=target
    save("status.json",state)
    operation=os.environ.get("OPERATION") or "run"
    if operation=="run":
        for deployed in {service["sha"] for service in state["services"].values() if service}:
            if subprocess.run(["git","merge-base","--is-ancestor",deployed,target],check=False).returncode:
                raise ValueError("Target predates or diverges from a deployed revision; start a new run or use rollback")
    impact={"web":False,"backend":False,"manualPaths":[]}
    if operation=="run": impact=json.loads(call("node","scripts/site-release/plan.mjs","status.json",target))
    result="run"
    if operation not in ("run","pause","resume","rollback"): raise ValueError("Unsupported workflow operation")
    if operation in ("pause","resume"): result=operation
    elif state["vm"]["status"]!="RUNNING": raise ValueError("VM is stopped; consult the host expiry section")
    elif (now()-parse_time(state["hostObservedAt"])).total_seconds()>1800:
        raise ValueError("Host snapshot is stale; inspect site-release.timer and its journal")
    elif state["hostVersion"]!=host_version(HERE):
        raise ValueError("Install the reviewed receiver version before running the workflow")
    elif operation=="rollback":
        if not any(c["releaseId"]==os.environ.get("ROLLBACK_ID") for c in state["rollbackCandidates"]):
            raise ValueError("Requested release is not a compatible rollback candidate")
        result="rollback"
    elif state["paused"]: result="paused"
    elif impact["manualPaths"] and os.environ.get("REVIEWED_HOST_PREREQUISITES")!=target:
        raise ValueError("Operator prerequisites require review: "+", ".join(impact["manualPaths"][:6]))
    elif not impact["web"] and not impact["backend"]: result="skipped"
    state["lastResult"]=result if result in ("paused","skipped") else "planned"
    save("status.json",state)
    output("decision",result)
    for k in ("web","backend"): output(k,str(impact[k]).lower() if result=="run" else "false")
    print(json.dumps({"operation":operation,"result":result,"target":target,"services":impact,"vm":state["vm"],"expiryWarningDays":state.get("expiryWarningDays")}))

def put(client,key,value,gen):
    with tempfile.NamedTemporaryFile(mode="w",delete=False) as tmp:
        json.dump(value,tmp)
    try: return client.put(key,tmp.name,gen)
    finally: Path(tmp.name).unlink()

def publish():
    state=readfile("status.json")
    if state["sourceSha"]!=os.environ["GITHUB_SHA"]:
        raise ValueError("Candidate differs from the pinned preflight revision")
    client=Client(BUCKET)
    operation=os.environ["DECISION"]
    mode=client.read_version("control/mode.json")
    if mode["generation"]!=state["controlGeneration"]: raise ValueError("Control state changed since preflight")
    if operation in ("pause","resume","rollback"):
        paused=operation!="resume"
        gen=put(client,"control/mode.json",{"paused":paused,"updatedAt":stamp(),"id":run_id()},mode["generation"])
        if operation!="rollback":
            print("Automatic deployment "+("paused" if paused else "resumed"))
            return
    else:
        if (mode["value"] or {}).get("paused"): raise ValueError("Automatic deployment paused")
        gen=mode["generation"]
    if client.read_version("status/live.json")["value"]["services"]!=state["services"]:
        raise ValueError("Live baseline changed since preflight")
    images=readfile("digests.json") if operation=="run" else {}
    for kind in ["backend","web"]:
        if (kind in images)!=(operation=="run" and os.environ[kind.upper()]=="true"):
            raise ValueError("Candidate set differs from checked build")
    cmd={"schema":1,"id":run_id(),"operation":operation,"target":os.environ["GITHUB_SHA"],"baseline":state["services"],
         "images":images,"issuedAt":stamp(),"expiresAt":(now()+timedelta(minutes=20)).isoformat(),
         "rollbackId":os.environ.get("ROLLBACK_ID") or None,"controlGeneration":gen,"hostVersion":host_version(HERE)}
    check_command(cmd)
    client=Client(BUCKET)
    existing=client.read_version("commands/current.json")
    previous=existing["value"]
    if previous and not client.read_version("receipts/"+previous["id"]+".json")["value"] and parse_time(previous["expiresAt"])>now():
        raise ValueError("Earlier command has no terminal receipt yet; inspect original run")
    put(client,"commands/current.json",cmd,existing["generation"])
    print("Published "+cmd["id"]+"; waiting for its host receipt",flush=True)
    for _ in range(96):
        receipt=Client(BUCKET).read_version("receipts/"+cmd["id"]+".json")["value"]
        if receipt:
            print(json.dumps(receipt))
            if receipt["id"]!=cmd["id"] or receipt["result"]!="deployed": raise ValueError("Host did not confirm deployment")
            return
        time.sleep(10)
    raise ValueError("Host receipt pending; inspect original run before any further release")

def public_checks(state):
    import hashlib
    with urlopen(ORIGIN+"/",timeout=15) as response:
        if hashlib.sha256(response.read(2*1024*1024)).hexdigest()!=state["htmlSha256"]:
            raise ValueError("Public homepage hash differs from host")
    if api(ORIGIN+"/api/health")["status"]!="ok": raise ValueError("Public health check failed")
    # Adopted legacy images have no release endpoints; the first managed replacement does.
    for service,path in (("web","/site-version.json"),("api","/api/version")):
        if state.get("versionEndpoints",{}).get(service):
            if api(ORIGIN+path)["revision"]!=state["services"][service]["sha"]:
                raise ValueError("Public revision mismatch for "+service)

def report():
    state=observe()
    decision=os.environ.get("DECISION") or "failed"
    jobs=[os.environ.get(x) for x in ("CHECK_RESULT","BUILD_RESULT","PUBLISH_RESULT")]
    failed=any(x not in ("success","skipped") for x in jobs)
    receipt=Client(BUCKET).read_version("receipts/"+run_id()+".json")["value"]
    state["receipt"]=receipt
    if receipt and receipt["result"]=="failed": failed=True
    if not failed and decision in ("run","rollback","skipped"):
        try:
            if decision!="skipped" and (not receipt or state["releaseId"]!=run_id()):
                raise ValueError("VM did not report the requested release")
            public_checks(state)
        except Exception as error:
            failed=True
            state["verificationError"]=str(error)[:250]
    state.update(lastResult="failed" if failed else "deployed" if decision in ("run","rollback") else decision,
                 sourceSha=os.environ["GITHUB_SHA"],checkId=run_id())
    save("status.json",state)
    print(json.dumps(state))
    if failed: raise ValueError("A release job failed. Consult the failing step and the original receipt.")

if __name__=="__main__":
    if os.environ.get("GITHUB_REPOSITORY")!=REPOSITORY or os.environ.get("GITHUB_REF")!="refs/heads/master":
        sys.exit("Production workflow requires the official master ref")
    {"plan":plan,"publish":publish,"report":report}[sys.argv[1]]()
