"""Exercise the real receiver state machine with isolated disk, Docker and GCS fakes."""
import copy
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
import importlib.util
import hashlib
import io
import json
import os
from pathlib import Path
from types import SimpleNamespace
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch


SOURCE = Path(__file__).resolve().parents[1]


def load(name, filename, dependencies=None):
    spec = importlib.util.spec_from_file_location(name, SOURCE / filename)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, dependencies or {}):
        spec.loader.exec_module(module)
    return module


protocol = load("receiver_test_protocol", "protocol.py")
store = load("receiver_test_store", "store.py")
host = load("receiver_test_host", "host.py", {"protocol": protocol})
controller = load("receiver_test_controller", "controller.py", {"protocol": protocol, "store": store})
CLOCK = datetime(2026, 11, 12, 12, tzinfo=timezone.utc)
TARGET = "3" * 40


def image(kind, revision, digit):
    digest = "sha256:" + digit * 64
    return {"sha": revision, "digest": digest, "localId": digest,
            "ref": protocol.REPO + kind + "@" + digest}


class ReceiverTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.root = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.events, self.cloud, self.cloud_changes = [], {}, []
        self.stopped = set()
        self.fail_backend = None
        self.fail_web_once = False
        self.lose_receipt_ack = False
        self.old_web = image("web", "1" * 40, "1")
        self.old_backend = image("backend", "2" * 40, "2")
        self.new_web = image("web", TARGET, "3")
        self.new_backend = image("backend", TARGET, "4")
        self.images = {entry[key]: entry for entry in (self.old_web, self.old_backend, self.new_web, self.new_backend)
                       for key in ("ref", "localId")}
        self.runtime = {"web": copy.deepcopy(self.old_web), "api": copy.deepcopy(self.old_backend),
                        "worker": copy.deepcopy(self.old_backend)}
        self.unhealthy = set()
        self.layout = {"files": ["/production/compose.yaml"], "env": "/production/pilot.env",
                       "wd": "/production", "config": {"/production/compose.yaml": "fixed"}}
        self.initial = {"releaseId": "baseline-" + "1" * 12, "services": copy.deepcopy(self.runtime),
                        "history": [], "html": self.html(self.old_web), "layout": self.layout}
        self.stack.enter_context(patch.dict(sys.modules, {"protocol": protocol}))
        for name, value in {"ROOT": self.root, "STATE": self.root / "state.json",
                            "JOURNAL": self.root / "journal.json", "OVERRIDE": self.root / "images.json"}.items():
            self.stack.enter_context(patch.object(host, name, value))
        self.stack.enter_context(patch.object(host, "write", self.write))
        self.stack.enter_context(patch.object(host, "run", self.docker))
        self.stack.enter_context(patch.object(host.subprocess, "check_output", self.http_probe))
        self.stack.enter_context(patch.object(host.subprocess, "run", side_effect=AssertionError("Unexpected real subprocess")))
        self.stack.enter_context(patch.object(host, "layout", lambda: copy.deepcopy(self.layout)))
        self.stack.enter_context(patch.object(host, "cloud_read", self.cloud_read))
        self.stack.enter_context(patch.object(host, "cloud_write", self.cloud_write))
        self.stack.enter_context(patch.object(host, "pull", self.pull))
        self.stack.enter_context(patch.object(host, "url", self.url))
        self.stack.enter_context(patch.object(host, "host_version", return_value="f" * 64))
        self.stack.enter_context(patch.object(host, "maintenance", lambda: self.events.append(("maintenance",))))
        self.stack.enter_context(patch.object(host, "reopen", lambda: self.events.append(("reopen",))))
        self.stack.enter_context(patch.object(host, "idle", lambda: self.events.append(("idle",))))
        self.stack.enter_context(patch.object(host.shutil, "disk_usage", return_value=SimpleNamespace(free=10 * 1024**3)))
        self.stack.enter_context(patch.object(protocol, "now", return_value=CLOCK))
        self.stack.enter_context(patch.object(host, "now", return_value=CLOCK))
        self.write(host.STATE, self.initial)
        self.write(self.root / "heartbeat.json", CLOCK.isoformat())
        self.cloud["control/mode.json"] = {"generation": "10", "value": {"paused": False}}
        self.cloud["status/live.json"] = {"generation": "1", "value": host.summary(self.initial)}

    def write(self, path, value):
        # Exercise durable journal reloads without the Linux-only directory fsync.
        path.write_text(json.dumps(value), encoding="utf-8")
        self.events.append(("write", path.name))

    def cloud_read(self, key):
        return copy.deepcopy(self.cloud.get(key, {"generation": "0", "value": None}))

    def cloud_write(self, key, value):
        current = self.cloud_read(key)
        if current["value"] == value:
            return
        self.cloud[key] = {"generation": str(int(current["generation"]) + 1), "value": copy.deepcopy(value)}
        self.cloud_changes.append((key, copy.deepcopy(value)))
        if key.startswith("receipts/") and self.lose_receipt_ack:
            self.lose_receipt_ack = False
            raise RuntimeError("Receipt write acknowledgement lost")

    def pull(self, kind, digest, sha):
        self.events.append(("pull", kind))
        entry = self.new_web if kind == "web" else self.new_backend
        self.assertEqual((digest, sha), (entry["digest"], entry["sha"]))
        return copy.deepcopy(entry)

    def html(self, entry):
        return hashlib.sha256(self.html_bytes(entry)).hexdigest()

    def html_bytes(self, entry):
        return b"<html>old</html>" if entry["localId"] == self.old_web["localId"] else b"<html>new</html>"

    def http_probe(self, args, **kwargs):
        self.assertEqual(args[0], "curl")
        self.assertEqual(args[-1], protocol.ORIGIN + "/")
        self.assertIn("ex-machina.eu.org:443:127.0.0.1", args)
        return self.html_bytes(self.runtime["web"])

    def url(self, path):
        if path == "/api/health":
            return json.dumps({"status": "ok"})
        name = "web" if path == "/site-version.json" else "api"
        return json.dumps({"revision": self.runtime[name]["sha"]})

    def docker(self, args, data=None, timeout=150):
        self.assertEqual(args[0], "docker", "No real processes or network may escape the receiver fake")
        if args[1] == "inspect":
            name = args[2].removeprefix("yuban-p1-").removesuffix("-1")
            entry = self.runtime[name]
            return json.dumps([{"Image": entry["localId"], "State": {"Running": name not in self.stopped,
                               "Health": {"Status": "unhealthy" if name in self.unhealthy else "healthy"}}}])
        if args[1:3] == ["image", "inspect"]:
            entry = self.images[args[3]]
            return json.dumps([{"Id": entry["localId"], "RepoDigests": [entry["ref"]],
                               "Config": {"Labels": {"org.opencontainers.image.revision": entry["sha"]}}}])
        if args[1] == "compose":
            if "config" in args:
                self.events.append(("compose-config",))
                return ""
            targets = [name for name in protocol.SERVICES if name in args]
            if "stop" in args:
                self.events.append(("compose-stop", tuple(targets)))
                self.stopped.update(targets)
                return ""
            selected = host.read(host.OVERRIDE)["services"]
            self.events.append(("compose-up", tuple(targets), {name: selected[name]["image"] for name in targets}))
            for name in targets:
                if self.fail_backend == "partial" and name == "worker":
                    continue
                self.runtime[name] = copy.deepcopy(self.images[selected[name]["image"]])
                self.stopped.discard(name)
            if "api" in targets and self.fail_backend:
                raise RuntimeError("Backend compose acknowledgement failed after possible writes")
            if targets == ["web"] and self.fail_web_once:
                self.fail_web_once = False
                raise RuntimeError("Web startup failed")
            return ""
        if args[1] == "run":
            entry = self.images[args[-2]]
            return self.html(entry) + "  /srv/index.html" if args[-1] == "/srv/index.html" else json.dumps({"revision": entry["sha"]})
        if args[1] == "exec" and args[-1] == "/srv/index.html":
            return self.html(self.runtime["web"]) + "  /srv/index.html"
        self.fail("Unexpected Docker request: " + repr(args))

    def command(self, images=None, **overrides):
        value = {"schema": 1, "id": "r123-1", "operation": "run", "target": TARGET,
                 "baseline": host.wire(self.initial["services"]),
                 "images": images if images is not None else {"backend": self.new_backend["digest"], "web": self.new_web["digest"]},
                 "issuedAt": CLOCK.isoformat(), "expiresAt": (CLOCK + timedelta(minutes=20)).isoformat(),
                 "rollbackId": None, "controlGeneration": "10", "hostVersion": "f" * 64}
        value.update(overrides)
        return value

    def receipt(self):
        return self.cloud_read("receipts/r123-1.json")["value"]

    def ups(self):
        return [entry for entry in self.events if entry[0] == "compose-up"]

    def test_expired_command_is_rejected_before_staging_or_runtime_changes(self):
        cmd = self.command(issuedAt=(CLOCK - timedelta(minutes=30)).isoformat(),
                           expiresAt=(CLOCK - timedelta(minutes=10)).isoformat())
        with self.assertRaisesRegex(ValueError, "Expired"):
            protocol.check_command(cmd, CLOCK)
        host.apply(cmd)
        self.assertEqual(self.runtime, self.initial["services"])
        self.assertEqual(self.ups(), [])
        self.assertFalse(any(event[0] in ("pull", "maintenance") for event in self.events))
        self.assertEqual(self.receipt()["result"], "failed")

    def test_failed_candidate_preparation_leaves_old_services_and_proxy_running(self):
        with patch.object(host, "pull", side_effect=RuntimeError("Candidate digest could not be staged")):
            host.apply(self.command())
        self.assertEqual(self.runtime, self.initial["services"])
        self.assertEqual(host.read(host.STATE), self.initial)
        self.assertEqual(self.ups(), [])
        self.assertNotIn(("maintenance",), self.events)
        self.assertEqual(self.receipt()["stage"], "staging")
        self.assertEqual(self.receipt()["result"], "failed")

    def test_command_that_expires_while_draining_never_starts_candidate_services(self):
        def drain():
            self.events.append(("idle",))
            protocol.now.return_value = CLOCK + timedelta(minutes=21)
        with patch.object(host, "idle", side_effect=drain):
            host.apply(self.command())
        self.assertEqual(self.runtime, self.initial["services"])
        self.assertEqual(self.ups(), [])
        self.assertEqual(self.receipt()["result"], "failed")
        self.assertEqual(self.receipt()["stage"], "draining")
        self.assertIn("Expired", self.receipt()["reason"])

    def test_possible_backend_writes_retain_healthy_new_backend_and_restore_only_old_web(self):
        self.fail_web_once = True
        host.apply(self.command())
        current = host.read(host.STATE)
        self.assertEqual(current["services"]["api"], self.new_backend)
        self.assertEqual(current["services"]["worker"], self.new_backend)
        self.assertEqual(current["services"]["web"], self.old_web)
        self.assertEqual([entry[1] for entry in self.ups()], [("api", "worker"), ("web",), ("web",)])
        self.assertEqual(self.ups()[-1][2], {"web": self.old_web["ref"]})
        self.assertEqual(self.receipt()["result"], "failed")
        self.assertNotIn("maintenanceRequired", self.receipt())
        wire = host.summary(current)
        self.assertEqual(wire["services"]["api"]["sha"], TARGET)
        self.assertEqual(wire["services"]["web"]["sha"], self.old_web["sha"])

    def test_uncertain_partial_backend_never_blindly_reverts_or_claims_a_known_baseline(self):
        self.fail_backend = "partial"
        before = self.cloud_read("status/live.json")
        host.apply(self.command())
        self.assertEqual(self.runtime["api"], self.new_backend)
        self.assertEqual(self.runtime["worker"], self.old_backend)
        self.assertEqual([entry[1] for entry in self.ups()], [("api", "worker")])
        self.assertTrue(self.receipt()["maintenanceRequired"])
        self.assertTrue((self.root / "blocked.json").exists())
        self.assertIn(("compose-stop", ("worker",)), self.events)
        self.assertEqual(self.cloud_read("status/live.json"), before)
        with self.assertRaisesRegex(RuntimeError, "Operator recovery"):
            host.poll()

    def test_lost_receipt_ack_reloads_original_terminal_result_without_reapplying(self):
        cmd = self.command()
        self.cloud["commands/current.json"] = {"generation": "1", "value": cmd}
        self.lose_receipt_ack = True
        with self.assertRaisesRegex(RuntimeError, "acknowledgement lost"):
            host.apply(cmd)
        original = copy.deepcopy(self.receipt())
        journal = host.read(host.JOURNAL)
        self.assertEqual(journal["terminal"], original)
        before = copy.deepcopy(self.ups())
        host.poll()
        host.poll()
        host.poll()
        self.assertFalse(host.JOURNAL.exists())
        self.assertEqual(self.ups(), before)
        self.assertEqual(self.receipt(), original)
        self.assertEqual(len([key for key, _ in self.cloud_changes if key.startswith("receipts/")]), 1)

    def test_interrupted_commit_recovers_receipt_without_replacing_any_container(self):
        state = copy.deepcopy(self.initial)
        state.update(releaseId="r123-1", services={"api": self.new_backend, "worker": self.new_backend, "web": self.new_web}, html=self.html(self.new_web))
        self.runtime = copy.deepcopy(state["services"])
        self.write(host.STATE, state)
        self.write(host.JOURNAL, {"id": "r123-1", "phase": "switching-web", "candidate": state["services"]})
        host.poll()
        self.assertEqual(self.ups(), [])
        self.assertEqual(self.receipt()["result"], "deployed")
        self.assertFalse(host.JOURNAL.exists())

    def test_interrupted_mixed_recovery_commit_preserves_failed_result_without_reapplying(self):
        candidate = {"api": self.new_backend, "worker": self.new_backend, "web": self.new_web}
        state = copy.deepcopy(self.initial)
        state.update(releaseId="r123-1", services={**candidate, "web": self.old_web}, history=[host.saved(self.initial)])
        self.runtime = copy.deepcopy(state["services"])
        original = {"id": "r123-1", "result": "failed", "stage": "switching-web",
                    "reason": "Original failed release; retained healthy backend and restored previous Web",
                    "observedAt": CLOCK.isoformat()}
        self.write(host.STATE, state)
        self.write(host.JOURNAL, {"id": "r123-1", "phase": "switching-web", "candidate": candidate,
                                  "recoveryResult": original})
        host.poll()
        self.assertEqual(self.ups(), [])
        self.assertEqual(self.receipt(), original)
        self.assertEqual(host.read(host.STATE), state)

    def test_interrupted_recovery_before_state_commit_retains_original_failure_evidence(self):
        candidate = {"api": self.new_backend, "worker": self.new_backend, "web": self.new_web}
        self.runtime = copy.deepcopy({**candidate, "web": self.old_web})
        original = {"id": "r123-1", "result": "failed", "stage": "switching-web",
                    "reason": "Original Web startup failure; retained healthy backend and restored previous Web",
                    "observedAt": CLOCK.isoformat()}
        self.write(host.JOURNAL, {"id": "r123-1", "phase": "switching-web", "candidate": candidate,
                                  "recoveryResult": original})
        host.poll()
        self.assertEqual(self.receipt(), original)
        current = host.read(host.STATE)
        self.assertEqual(current["services"]["api"], self.new_backend)
        self.assertEqual(current["services"]["web"], self.old_web)
        self.assertEqual(len(current["history"]), 1)
        self.assertFalse(any(set(entry[1]) & {"api", "worker"} for entry in self.ups()))

    def test_web_only_release_keeps_backend_revisions_and_avoids_drain(self):
        host.apply(self.command(images={"web": self.new_web["digest"]}))
        current = host.read(host.STATE)
        self.assertEqual(current["services"]["web"], self.new_web)
        self.assertEqual(current["services"]["api"], self.old_backend)
        self.assertEqual(current["services"]["worker"], self.old_backend)
        self.assertEqual([entry[1] for entry in self.ups()], [("web",)])
        self.assertNotIn(("maintenance",), self.events)
        self.assertNotIn(("idle",), self.events)
        self.assertEqual(self.receipt()["result"], "deployed")

    def test_original_cloud_receipt_prevents_same_command_from_running_again(self):
        self.cloud["commands/current.json"] = {"generation": "1", "value": self.command()}
        original = {"id": "r123-1", "result": "failed", "stage": "staging", "reason": "Original candidate failed"}
        self.cloud["receipts/r123-1.json"] = {"generation": "1", "value": original}
        host.poll()
        host.poll()
        self.assertEqual(self.ups(), [])
        self.assertFalse(any(event[0] == "pull" for event in self.events))
        self.assertEqual(self.receipt(), original)


class ControllerReportTests(unittest.TestCase):
    def test_failed_original_receipt_preserves_observed_separate_service_versions(self):
        services = {"api": {"sha": TARGET, "digest": "sha256:" + "4" * 64},
                    "worker": {"sha": TARGET, "digest": "sha256:" + "4" * 64},
                    "web": {"sha": "1" * 40, "digest": "sha256:" + "1" * 64}}
        state = {"services": services, "releaseId": "r123-1"}
        receipt = {"id": "r123-1", "result": "failed", "stage": "switching-web", "reason": "Old Web restored"}
        client = Mock()
        client.read_version.return_value = {"generation": "7", "value": receipt}
        saved = {}
        environment = {"GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1", "GITHUB_SHA": TARGET,
                       "DECISION": "run", "CHECK_RESULT": "success", "BUILD_RESULT": "success", "PUBLISH_RESULT": "failure"}
        with patch.dict(os.environ, environment), patch.object(controller, "observe", return_value=copy.deepcopy(state)), \
                patch.object(controller, "Client", return_value=client), \
                patch.object(controller, "save", side_effect=lambda name, value: saved.update({name: copy.deepcopy(value)})), \
                patch.object(controller, "public_checks") as probes, patch("sys.stdout", new_callable=io.StringIO):
            with self.assertRaisesRegex(ValueError, "release job failed"):
                controller.report()
        self.assertEqual(saved["status.json"]["services"], services)
        self.assertEqual(saved["status.json"]["receipt"], receipt)
        self.assertEqual(saved["status.json"]["lastResult"], "failed")
        self.assertEqual(saved["status.json"]["checkId"], "r123-1")
        probes.assert_not_called()
        client.read_version.assert_called_once_with("receipts/r123-1.json")


if __name__ == "__main__":
    unittest.main()
