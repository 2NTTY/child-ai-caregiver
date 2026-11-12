"""Root-owned receiver on the existing VM. The release mailbox contains data only."""
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from protocol import (BUCKET, ORIGIN, REPO, REV, SERVICES, check_command, check_services,
                      host_version, now, parse_time, stamp)

HERE = Path(__file__).resolve().parent
ROOT = Path("/var/lib/yuyoufang-site-release")
STATE, JOURNAL, OVERRIDE = (ROOT/name for name in ("state.json", "journal.json", "images.json"))

def run(args, data=None, timeout=150):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, timeout=timeout)
    if result.returncode:
        # Subprocess stderr may contain private docker/compose values; retain the stage in the receipt.
        raise RuntimeError(f"{Path(args[0]).name} {args[1] if len(args)>1 else ''}: exit {result.returncode}")
    return result.stdout.strip()

def write(path, value):
    with tempfile.NamedTemporaryFile(mode="w", dir=ROOT, delete=False) as tmp:
        json.dump(value, tmp, sort_keys=True)
        tmp.flush()
        os.fsync(tmp.fileno())
    os.replace(tmp.name, path)
    fd = os.open(ROOT, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def read(path):
    return json.loads(path.read_text())

def cloud_read(key):
    return json.loads(run([sys.executable, str(HERE/"store.py"), "read-version", BUCKET, key]))

def cloud_write(key, value):
    version = cloud_read(key)
    if version["value"] == value:
        return
    with tempfile.NamedTemporaryFile(mode="w", dir=ROOT) as tmp:
        json.dump(value, tmp)
        tmp.flush()
        run([sys.executable, str(HERE/"store.py"), "put", BUCKET, key, tmp.name, version["generation"]])

def container(name):
    # Never log the raw inspect response (environment and mount metadata).
    return json.loads(run(["docker", "inspect", "yuban-p1-"+name+"-1"]))[0]

def image_info(ref):
    return json.loads(run(["docker","image","inspect",ref]))[0]

def snapshot(name):
    c = container(name)
    img = image_info(c["Image"])
    sha = (img["Config"].get("Labels") or {}).get("org.opencontainers.image.revision", "")
    if not REV.fullmatch(sha):
        raise RuntimeError("Missing revision label for "+name)
    managed=[ref for ref in (img.get("RepoDigests") or []) if ref.startswith(REPO+("web" if name=="web" else "backend")+"@sha256:")]
    if len(managed)==1:
        return {"sha":sha,"digest":managed[0].split("@")[1],"ref":managed[0],"localId":c["Image"]}
    # Local-only release images can lack a registry digest. Retain a Compose-compatible tag.
    tag="yuyoufang-site-baseline:"+name+"-"+c["Image"].split(":")[1]
    run(["docker","tag",c["Image"],tag])
    return {"sha":sha, "digest":c["Image"], "ref":tag, "localId":c["Image"]}

def wire(services):
    return {k:{"sha":v["sha"],"digest":v["digest"]} for k,v in services.items()}

def layout():
    labels = container("api")["Config"]["Labels"]
    files = [p for p in labels["com.docker.compose.project.config_files"].split(",") if Path(p) != OVERRIDE]
    env = labels["com.docker.compose.project.environment_file"]
    wd = labels["com.docker.compose.project.working_dir"]
    if labels["com.docker.compose.project"] != "yuban-p1" or not files or not Path(wd).is_absolute():
        raise RuntimeError("Unexpected production Compose project")
    if any(not Path(f).is_absolute() or not Path(f).is_file() for f in [*files,env]):
        raise RuntimeError("Production Compose inputs missing")
    # Include mounted private configuration in the guard; never export its content or hashes.
    private_env = Path(env).with_name("firebase.env")
    inputs = [*files, env, str(private_env)]
    return {"files":files,"env":env,"wd":wd,
            "config":{p:hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in inputs}}

def compose(state, args):
    cfg=state["layout"]
    cmd=["docker","compose","--project-directory",cfg["wd"],"-p","yuban-p1","--env-file",cfg["env"]]
    for f in [*cfg["files"],str(OVERRIDE)]:
        cmd.extend(["-f",f])
    return run([*cmd,*args],timeout=210)

def set_images(services):
    for info in services.values():
        if image_info(info["ref"])["Id"] != info["localId"]:
            raise RuntimeError("Selected image no longer matches its recorded local ID")
    write(OVERRIDE,{"services":{s:{"image":services[s]["ref"]} for s in SERVICES}})

def check_live(services):
    for s in SERVICES:
        c=container(s)
        if c["Image"] != services[s]["localId"] or not c["State"]["Running"]:
            raise RuntimeError("Runtime identity mismatch: "+s)
        if s!="web" and c["State"].get("Health",{}).get("Status")!="healthy":
            raise RuntimeError("Unhealthy "+s)

def webhash():
    return run(["docker","exec","yuban-p1-web-1","sha256sum","/srv/index.html"]).split()[0]

def url(path):
    return run(["curl","--fail","--silent","--show-error","--noproxy","*","--max-time","12",
                "--resolve","ex-machina.eu.org:443:127.0.0.1",ORIGIN+path])

def health(services, html):
    check_live(services)
    served = subprocess.check_output(["curl","--fail","--silent","--noproxy","*","--max-time","12",
                     "--resolve","ex-machina.eu.org:443:127.0.0.1",ORIGIN+"/"],timeout=15)
    if hashlib.sha256(served).hexdigest()!=html or webhash()!=html or json.loads(url("/api/health"))["status"]!="ok":
        raise RuntimeError("Public health or homepage fingerprint differs")
    if services["web"]["ref"].startswith(REPO) and json.loads(url("/site-version.json"))["revision"]!=services["web"]["sha"]:
        raise RuntimeError("Served Web revision differs")
    if services["api"]["ref"].startswith(REPO) and json.loads(url("/api/version"))["revision"]!=services["api"]["sha"]:
        raise RuntimeError("Served API revision differs")

def summary(state):
    candidates=[]
    for old in state["history"]:
        current=state["services"]
        compatible=backend_compatible(current["api"],old["services"]["api"])
        if old["services"]["web"]["localId"]!=current["web"]["localId"] or (compatible and old["services"]["api"]!=current["api"]):
            candidates.append({"releaseId":old["releaseId"],"services":wire(old["services"]),
                               "compatibility":"full" if compatible else "web-only"})
    return {"observedAt":stamp(),"releaseId":state["releaseId"],"services":wire(state["services"]),
            "htmlSha256":state["html"],"rollbackCandidates":candidates,"hostVersion":host_version(HERE),
            "versionEndpoints":{s:state["services"][s]["ref"].startswith(REPO) for s in ("web","api")}}

def saved(state):
    return {k:copy.deepcopy(state[k]) for k in ("releaseId","services","html")}

def backend_compatible(candidate, previous):
    if candidate["localId"]==previous["localId"]: return True
    path=ROOT/"compatible-backends.json"
    return path.exists() and [candidate["sha"],previous["sha"]] in read(path)

def approve_backend_pair(source, destination):
    if not REV.fullmatch(source) or not REV.fullmatch(destination) or source==destination:
        raise ValueError("Provide exact writer SHA and proven rollback reader SHA")
    state=read(STATE)
    known={s["services"]["api"]["sha"] for s in [state,*state["history"]]}
    if destination not in known: raise ValueError("Rollback image must already be retained")
    path=ROOT/"compatible-backends.json"
    pairs=read(path) if path.exists() else []
    if [source,destination] not in pairs:
        write(path,[*pairs[-15:],[source,destination]])
    cloud_write("status/live.json",summary(state))

def accept_repaired(expected):
    # Operator has applied a forward fix, resumed normal Caddy configuration and
    # proven the running reader/worker understands writes made during the incident.
    marker=ROOT/"blocked.json"
    if not REV.fullmatch(expected) or not marker.exists() or JOURNAL.exists():
        raise ValueError("A resolved incident and exact recovered backend SHA are required")
    mode=cloud_read("control/mode.json")["value"] or {}
    if not mode.get("paused"): raise ValueError("Pause automatic releases first")
    services={s:snapshot(s) for s in SERVICES}
    check_services(wire(services))
    if services["api"]["sha"]!=expected: raise ValueError("Unexpected repaired backend revision")
    state=read(STATE)
    previous=saved(state)
    state.update(services=services,layout=layout(),html=webhash(),releaseId="baseline-"+services["web"]["sha"][:12])
    health(services,state["html"])
    state["history"]=([previous]+state["history"])[:2]
    set_images(services)
    compose(state,["config","--quiet"])
    write(STATE,state)
    cloud_write("status/live.json",summary(state))
    marker.rename(ROOT/("repaired-"+read(marker)["id"]+".json"))

def adopt():
    if STATE.exists():
        state=read(STATE)
        if JOURNAL.exists() or layout()!=state["layout"]:
            raise RuntimeError("Checkout or configuration drift; inspect active deployment")
    else:
        services={s:snapshot(s) for s in SERVICES}
        check_services(wire(services))
        state={"services":services,"releaseId":"baseline-"+services["web"]["sha"][:12],"layout":layout(),
               "history":[],"html":webhash()}
    health(state["services"],state["html"])
    set_images(state["services"])
    compose(state,["config","--quiet"])
    write(STATE,state)
    cloud_write("status/live.json",summary(state))

def maintenance():
    caddy="ex-machina.eu.org {\n header Retry-After 45\n respond \"Brief maintenance\" 503\n}\n"
    run(["docker","exec","-i","yuban-p1-web-1","caddy","reload","--adapter","caddyfile","--config","-"],caddy)

def reopen():
    run(["docker","exec","yuban-p1-web-1","caddy","reload","--adapter","caddyfile","--config","/etc/caddy/Caddyfile"])

def idle():
    run(["sh",str(HERE/"activity.sh")],timeout=55)

def pull(kind,digest,sha):
    ref=REPO+kind+"@"+digest
    with tempfile.TemporaryDirectory(dir=ROOT) as d:
        response=run(["curl","-fsS","--noproxy","*","--max-time","8","-H","Metadata-Flavor: Google",
                      "http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token"])
        run(["docker","--config",d,"login","-u","oauth2accesstoken","--password-stdin","https://asia-east2-docker.pkg.dev"],
            json.loads(response)["access_token"])
        run(["docker","--config",d,"pull",ref],timeout=400)
    img=image_info(ref)
    if ref not in img.get("RepoDigests",[]) or img["Config"]["Labels"].get("org.opencontainers.image.revision")!=sha:
        raise RuntimeError("Pulled image identity differs: "+kind)
    return {"sha":sha,"digest":digest,"ref":ref,"localId":img["Id"]}

def guarded(state, cmd):
    check_command(cmd)
    mode=cloud_read("control/mode.json")
    if cmd["controlGeneration"]!=mode["generation"] or ((mode["value"] or {}).get("paused",False) and cmd["operation"]!="rollback"):
        raise RuntimeError("Release superseded or paused")
    if cmd["baseline"]!=wire(state["services"]) or layout()!=state["layout"] or cmd["hostVersion"]!=host_version(HERE):
        raise RuntimeError("Baseline or host inputs changed")
    check_live(state["services"])

def stage(state,cmd):
    services=copy.deepcopy(state["services"])
    html=state["html"]
    if cmd["operation"]=="rollback":
        old=next((x for x in state["history"] if x["releaseId"]==cmd["rollbackId"]),None)
        if not old or not any(c["releaseId"]==old["releaseId"] for c in summary(state)["rollbackCandidates"]):
            raise ValueError("No compatible rollback for that ID")
        if backend_compatible(services["api"],old["services"]["api"]):
            services.update(api=old["services"]["api"],worker=old["services"]["worker"])
        services["web"]=old["services"]["web"]
        image_info(services["web"]["localId"])
        html=old["html"]
    else:
        if shutil.disk_usage(ROOT).free < 3*1024**3:
            raise RuntimeError("Less than 3 GiB free to stage candidate; inspect retained images")
        for kind,digest in cmd["images"].items():
            info=pull(kind,digest,cmd["target"])
            if kind=="web":
                services["web"]=info
                html=run(["docker","run","--rm","--network","none","--read-only","--entrypoint","sha256sum",info["ref"],"/srv/index.html"]).split()[0]
                web=json.loads(run(["docker","run","--rm","--network","none","--read-only","--entrypoint","cat",info["ref"],"/srv/site-version.json"]))
                if web.get("revision")!=cmd["target"]:
                    raise RuntimeError("Web revision file does not match candidate")
            else:
                services["api"]=services["worker"]=info
    return services,html

def record(j, phase):
    j["phase"]=phase
    write(JOURNAL,j)

def receipt(j,result,reason):
    return {"id":j["id"],"result":result,"stage":j["phase"],"reason":reason,"observedAt":stamp()}

def finish(j, result):
    # Keep a durable terminal result until both writes have been acknowledged.
    if not j.get("terminal"):
        j["terminal"]=result
        write(JOURNAL,j)
    if not j["terminal"].get("maintenanceRequired") and not j["terminal"].get("runtimeUnknown"):
        cloud_write("status/live.json",summary(read(STATE)))
    cloud_write("receipts/"+j["id"]+".json",j["terminal"])
    JOURNAL.unlink()

def recover(j,reason):
    if j.get("terminal"):
        return finish(j,j["terminal"])
    state=read(STATE)
    if state["releaseId"]==j["id"] and not j.get("recoveryResult"):
        health(state["services"],state["html"])
        return finish(j,receipt(j,"deployed","Recovered committed release"))
    if state["releaseId"]==j["id"] and j.get("recoveryResult"):
        health(state["services"],state["html"])
        return finish(j,j["recoveryResult"])
    old=state["services"]
    try:
        if j["phase"] in ("preflight","staging"):
            result=receipt(j,"failed",reason)
            try: check_live(old)
            except Exception: result["runtimeUnknown"]=True
            return finish(j,result)
        elif j["phase"] in ("draining","prepared"):
            set_images(old)
            check_live(old)
            reopen()
            health(old,state["html"])
        else:
            # Backend may already have written. Restore old Web only when every backend is proven healthy.
            expected=j["candidate"]
            backends_ok=True
            for s in ("api","worker"):
                try:
                    c=container(s)
                    backends_ok &= c["Image"]==expected[s]["localId"] and c["State"].get("Health",{}).get("Status")=="healthy"
                except Exception: backends_ok=False
            effective={**expected,"web":old["web"]}
            if not backends_ok:
                if not backend_compatible(expected["api"],old["api"]):
                    raise RuntimeError("Backend compatibility requires operator recovery")
                effective=old
                # The receiver never runs a second worker. Quiesce before switching readers.
                idle()
                set_images(effective)
                compose(state,["up","-d","--pull","never","--no-build","--no-deps","--wait","--wait-timeout","120","api","worker"])
            # Recovery replaces only the Web container; healthy backends keep serving.
            # Web may be absent after a failed compose up, so do not reload it beforehand.
            set_images(effective)
            compose(state,["up","-d","--pull","never","--no-build","--no-deps","--wait","--wait-timeout","90","web"])
            reopen()
            health(effective,state["html"])
            if wire(effective)!=wire(old):
                if not j.get("recoveryResult"):
                    j["recoveryResult"]=receipt(j,"failed",reason+"; retained healthy backend and restored previous Web")
                write(JOURNAL,j)
                state["history"]=([saved(state)]+state["history"])[:2]
                state.update(services=effective,releaseId=j["id"])
                write(STATE,state)
    except Exception:
        try: maintenance()
        except Exception: pass
        try: compose(state,["stop","worker"])
        except Exception: pass
        result=receipt(j,"failed",reason+"; maintenance required, inspect original release")
        result["maintenanceRequired"]=True
        # A blocked release is an operator incident, not a baseline for fresh commands.
        write(ROOT/"blocked.json",result)
        return finish(j,result)
    finish(j,j.get("recoveryResult") or receipt(j,"failed",reason+"; compatible services retained"))

def apply(cmd):
    state=read(STATE)
    j={"id":cmd["id"],"phase":"preflight"}
    record(j,"preflight")
    try:
        guarded(state,cmd)
        record(j,"staging")
        services,html=stage(state,cmd)
        guarded(state,cmd)
        j.update(candidate=services)
        backend=services["api"]!=state["services"]["api"]
        web=services["web"]!=state["services"]["web"]
        if backend:
            record(j,"draining")
            maintenance()
            idle()
            # Expiry, pause, and in-flight checks still apply after the drain.
            guarded(state,cmd)
        record(j,"prepared")
        set_images(services)
        compose(state,["config","--quiet"])
        if backend:
            record(j,"backend-may-have-written")
            compose(state,["up","-d","--pull","never","--no-build","--no-deps","--wait","--wait-timeout","120","api","worker"])
        if web:
            record(j,"switching-web")
            compose(state,["up","-d","--pull","never","--no-build","--no-deps","--wait","--wait-timeout","90","web"])
        if backend:
            reopen()
        health(services,html)
        history=[saved(state),*state["history"]]
        state["history"]=history[:2]
        retained={i["ref"] for entry in [*state["history"],{"services":services}] for i in entry["services"].values()}
        obsolete={i["ref"] for entry in history[2:] for i in entry["services"].values() if i["ref"].startswith(REPO)}
        state.update(services=services,html=html,releaseId=cmd["id"])
        write(STATE,state)
        for ref in obsolete-retained:
            try: run(["docker","image","rm",ref])
            except RuntimeError: print("Retained referenced image "+ref,file=sys.stderr)
    except Exception as exc:
        # Only locally controlled phase / class reaches public logs. Private subprocess details stay off GitHub.
        reason = str(exc) if isinstance(exc,(ValueError,RuntimeError)) else type(exc).__name__
        return recover(j,reason[:220])
    finish(j,receipt(j,"deployed","Host identities and same-origin probes matched"))

def poll():
    if JOURNAL.exists():
        recover(read(JOURNAL),"Recovered interrupted receiver")
        return
    if (ROOT/"blocked.json").exists():
        raise RuntimeError("Operator recovery pending")
    heartbeat=ROOT/"heartbeat.json"
    if not heartbeat.exists() or (now()-parse_time(read(heartbeat))).total_seconds()>=900:
        state=read(STATE)
        if layout()!=state["layout"]: raise RuntimeError("Production configuration drift")
        health(state["services"],state["html"])
        cloud_write("status/live.json",summary(state))
        write(heartbeat,stamp())
    cmd=cloud_read("commands/current.json")["value"]
    if cmd is None:
        return
    from protocol import RUN
    if not RUN.fullmatch(str(cmd.get("id",""))):
        raise ValueError("Invalid command identifier")
    if (ROOT/"last.json").exists() and read(ROOT/"last.json")==cmd["id"]:
        return
    if cloud_read("receipts/"+cmd["id"]+".json")["value"] is None:
        apply(cmd)
    write(ROOT/"last.json",cmd["id"])

if __name__=="__main__":
    import fcntl
    with open("/run/lock/yuyoufang-site-release.lock","a") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        if sys.argv[1:]==["adopt"]:
            adopt()
        elif sys.argv[1:]==["poll"]:
            poll()
        elif len(sys.argv)==4 and sys.argv[1]=="approve-backend-pair":
            approve_backend_pair(*sys.argv[2:])
        elif len(sys.argv)==3 and sys.argv[1]=="accept-repaired":
            accept_repaired(sys.argv[2])
        else:
            sys.exit("Expected adopt, poll or approve-backend-pair WRITER_SHA READER_SHA")
