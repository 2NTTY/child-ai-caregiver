"""Trigger one protected-master website check for each Hong Kong daily slot."""
import argparse
import json
import os
import tempfile
import time
from datetime import timedelta
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from protocol import BUCKET, now, parse_time
from store import Client, StoreError

REPO = "2NTTY/child-ai-caregiver"
REPO_ID = 1377602504
WORKFLOW = "site-release.yml"
PATH = f"repos/{REPO}/actions/workflows/{WORKFLOW}"

class DispatchRejected(RuntimeError):
    pass


def check(at, github, claim, save_result, execute=False, acceptance_slot=None):
    slot = at.replace(hour=20, minute=17, second=0, microsecond=0)
    if slot > at:
        slot -= timedelta(days=1)
    day = slot.date().isoformat()
    if acceptance_slot and acceptance_slot + timedelta(minutes=3) <= at < acceptance_slot + timedelta(minutes=30):
        slot = acceptance_slot
        day = slot.strftime("%Y-%m-%dT%H-%MZ")
    elif at >= slot + timedelta(hours=4):
        return {"state": "outside-window", "slot": day}
    if not execute:
        return {"state": "would-dispatch", "slot": day}
    github.prepare_token()
    if not claim(day):
        return {"state": "already-claimed", "slot": day}
    try:
        run_id = github.dispatch(day)
    except DispatchRejected:
        save_result(day, "rejected", None)
        raise
    except Exception as failure:
        save_result(day, "unknown", None)
        raise RuntimeError("Check the original claim and GitHub runs before any operator retry") from failure
    save_result(day, "dispatched", run_id)
    return {"state": "dispatched", "slot": day, "runId": run_id}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


class GitHub:
    def __init__(self):
        self.token = None
        self.http = build_opener(NoRedirect())

    def request(self, path, body=None, token=None):
        headers = {"Accept": "application/vnd.github+json", "User-Agent": "yuyoufang-site-timer",
                   "X-GitHub-Api-Version": "2022-11-28", "Cache-Control": "no-cache"}
        if token:
            headers["Authorization"] = "Bearer " + token
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        req = Request("https://api.github.com/" + path, headers=headers, data=data)
        try:
            with self.http.open(req, timeout=15) as res:
                raw = res.read(1024 * 1024 + 1)
        except HTTPError as error:
            if path == PATH + "/dispatches" and error.code in (400, 401, 403, 404, 409, 422):
                raise DispatchRejected(f"GitHub rejected dispatch (HTTP {error.code})") from None
            raise RuntimeError(f"GitHub API returned HTTP {error.code}") from None
        if len(raw) > 1024 * 1024:
            raise ValueError("Unexpected response size")
        return json.loads(raw) if raw else {}

    def prepare_token(self):
        import jwt
        ts = int(time.time())
        app = os.environ["SITE_GITHUB_APP_ID"]
        installation = os.environ["SITE_GITHUB_INSTALLATION_ID"]
        if not app.isdecimal() or not installation.isdecimal():
            raise ValueError("Invalid GitHub App identity")
        key = Path("/secrets/github-app/private.pem").read_bytes()
        assertion = jwt.encode({"iat": ts - 60, "exp": ts + 480, "iss": app}, key, algorithm="RS256")
        token = self.request(f"app/installations/{installation}/access_tokens",
                             {"repository_ids": [REPO_ID], "permissions": {"actions": "write"}}, assertion)
        self.token = token["token"]

    def dispatch(self, day):
        response = self.request(PATH + "/dispatches", {"ref": "master", "inputs": {"operation": "daily", "slot": day}}, self.token)
        return response.get("workflow_run_id")


def write_once(day, result=False, state="claimed", run_id=None):
    name = "receipts/watchdog-" + day + ("-result" if result else "") + ".json"
    if Client(BUCKET).read_version(name)["value"] is not None:
        return False
    with tempfile.TemporaryDirectory() as directory:
        file = Path(directory) / "receipt.json"
        file.write_text(json.dumps({"slot": day, "state": state, "runId": run_id, "at": now().isoformat()}))
        try:
            Client(BUCKET).put(name, file, "0")
        except StoreError as error:
            if error.code == 41:
                return False
            raise
    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="Allow one workflow dispatch if due")
    mode.add_argument("--observe", action="store_true", help="Report the due slot without credentials or writes")
    args = parser.parse_args()
    acceptance = os.environ.get("SITE_TIMER_ACCEPTANCE_UTC")
    result = check(now(), GitHub(), write_once, lambda d, s, r: write_once(d, True, s, r), args.apply,
                   parse_time(acceptance) if acceptance else None)
    print(json.dumps(result))
