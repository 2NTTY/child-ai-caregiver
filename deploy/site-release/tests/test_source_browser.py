"""Exercise the operator journal and the real receiver override without contacting a site."""
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

DEPLOY = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(DEPLOY/"site-release"))
import host
module = importlib.util.spec_from_file_location("source_browser", DEPLOY/"source-browser/manage.py")
browser = importlib.util.module_from_spec(module)
module.loader.exec_module(browser)

class SourceBrowserRelease(unittest.TestCase):
    def setUp(self):
        stack = ExitStack()
        self.addCleanup(stack.close)
        self.root = Path(stack.enter_context(tempfile.TemporaryDirectory()))
        for name, path in {"ROOT": self.root, "STATE": self.root/"state.json", "OVERRIDE": self.root/"images.json",
                           "JOURNAL": self.root/"journal.json", "BROWSER_INSTALL": self.root/"bundles"}.items():
            stack.enter_context(patch.object(host, name, path))
        self.first, self.second = (self.spec(c) for c in ("a", "b"))
        stack.enter_context(patch.object(browser, "ACTIVE", self.root/"source-browser.json"))
        stack.enter_context(patch.object(browser, "PENDING", self.root/"source-browser-pending.json"))
        self.services = {s: {"ref": s, "localId": s} for s in host.SERVICES}
        self.site = {"services": self.services, "releaseId": "baseline", "layout": {}}
        host.write(host.STATE, self.site)
        self.side = None
        self.mounted = False
        self.events = []
        self.free = {"availableMemoryBytes": browser.RAM, "dockerFreeBytes": browser.FLOOR+10**9,
                     "receiverFreeBytes": browser.FLOOR+10**9}
        for obj, name, fn in [
            (host,"layout",lambda: {}), (host,"idle",lambda: None), (host,"container",self.container),
            (host,"run",self.run_docker),
            (host,"compose",self.compose), (browser,"sidecar",self.sidecar),
            (browser,"image",lambda spec: {"Id": spec["digest"]}), (host,"image_info",lambda ref: {"Id": ref}),
            (browser,"capacity",lambda: self.free), (browser,"renderer_exists",lambda: self.side is not None),
            (browser,"ensure_volume",lambda: None), (browser,"probe",lambda name: "ready"),
            (browser,"verify_renderer",self.verify_renderer)]:
            stack.enter_context(patch.object(obj, name, fn))

    def spec(self, char):
        rev = char*40
        files = host.browser_bundle(rev)
        (files/"p1").mkdir(parents=True)
        (files/"source-browser").mkdir()
        for f in ("p1/compose.firestore.source-browser.yaml", "source-browser/seccomp.json", "source-browser/compose.yaml"):
            shutil.copyfile(DEPLOY/f, files/f)
        return browser.candidate(rev, "sha256:"+char*64, 650000000)

    def container(self, name):
        mounts = [{"Destination": "/run/source-browser", "RW": False, "Type": "volume",
                   "Name": browser.VOLUME}] if self.mounted and name == "worker" else []
        return {"Image": name, "State": {"Running": True, "Health": {"Status": "healthy"}}, "Mounts": mounts}

    def run_docker(self, args):
        self.assertEqual(args, ["docker", "inspect", browser.NAME])
        return json.dumps([{"Image": self.side, "Config": {"Labels": {"com.docker.compose.project": browser.PROJECT}}}])

    def compose(self, site, args):
        if "up" in args:
            self.assertEqual(args[-1], "worker")
            overlay = host.read(host.OVERRIDE)
            self.assertEqual(overlay["services"]["worker"]["image"], "worker")
            self.mounted = "volumes" in overlay["services"]["worker"]
            self.events.append(("worker", self.mounted))

    def sidecar(self, spec, args):
        self.side = None if args == ["down"] else spec["digest"]
        self.events.append(("renderer", self.side))

    def verify_renderer(self, spec):
        self.assertEqual(spec["digest"], self.side)

    def apply(self, spec):
        return browser.operate(SimpleNamespace(action="apply", revision=spec["revision"], digest=spec["digest"],
                                              cold_bytes=spec["coldBytes"]))

    def rollback(self, spec):
        return browser.operate(SimpleNamespace(action="rollback", digest=spec["digest"]))

    def test_install_daily_regeneration_rotate_rollback_and_replay(self):
        self.apply(self.first)
        once = list(self.events)
        self.apply(self.first)
        self.assertEqual(self.events, once)
        host.set_images(self.services)
        self.assertEqual(host.read(host.OVERRIDE)["services"]["worker"]["volumes"],
                         ["source-browser-ipc:/run/source-browser:ro"])
        self.apply(self.second)
        def failing_probe(name):
            if self.side == self.second["digest"]:
                raise RuntimeError("Current renderer socket unavailable")
            return "ready"
        with patch.object(browser, "probe", failing_probe):
            self.rollback(self.second)
        done = list(self.events)
        self.rollback(self.second)
        self.assertEqual(self.events, done)
        self.assertEqual([event for event in done if event[0]=="worker"], [("worker",True)])
        self.assertEqual(self.side, self.first["digest"])
        self.assertEqual(host.read(host.STATE), self.site)
        self.mounted = False
        with self.assertRaisesRegex(RuntimeError, "lost its approved"):
            host.check_live(self.services)

    def test_interrupted_attach_recovers_before_daily_work_and_first_rollback_detaches(self):
        # A kill after applying the mount but before committing the new active receipt.
        before = browser.state()
        after = {"current": self.first, "previous": None}
        host.write(browser.PENDING, {"before": before, "after": after})
        browser.converge(self.site, self.first, None)
        browser.operate(SimpleNamespace(action="recover"))
        self.assertFalse(self.mounted)
        self.assertIsNone(self.side)
        self.assertFalse(browser.PENDING.exists())
        self.apply(self.first)
        self.rollback(self.first)
        self.rollback(self.first)
        host.set_images(self.services)
        self.assertNotIn("volumes", host.read(host.OVERRIDE))
        self.assertFalse(self.mounted)

    def test_low_space_or_unhealthy_candidate_preserves_running_version(self):
        self.apply(self.first)
        self.free["dockerFreeBytes"] = browser.FLOOR+1
        with patch.object(host, "image_info", side_effect=RuntimeError("absent")), patch.object(host, "pull") as pull:
            with self.assertRaisesRegex(RuntimeError, "Insufficient disk"):
                self.apply(self.second)
            pull.assert_not_called()
        self.free["dockerFreeBytes"] += 10**9
        def unhealthy(spec):
            if spec == self.second:
                raise RuntimeError("Unhealthy fixture")
            self.verify_renderer(spec)
        with patch.object(browser, "verify_renderer", unhealthy), self.assertRaisesRegex(RuntimeError, "Unhealthy"):
            self.apply(self.second)
        self.assertEqual(browser.state()["current"], self.first)
        self.assertEqual(self.side, self.first["digest"])
        self.assertTrue(self.mounted)
        self.assertFalse(browser.PENDING.exists())

if __name__ == "__main__":
    unittest.main()
