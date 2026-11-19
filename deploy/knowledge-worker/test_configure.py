import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import configure


class WorkerConfigurationTest(unittest.TestCase):
    def test_enable_rollback_and_disable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = root / "firebase.env"
            original = b"OTHER_SETTING=kept\n"
            env.write_bytes(original)
            live = {"env": [], "reject_once": True}
            def compose(state, args):
                if args[0] == "up":
                    if live["reject_once"]:
                        live["reject_once"] = False
                        raise RuntimeError("candidate unhealthy")
                    live["env"] = env.read_text().splitlines()
            def layout():
                return {"env": str(root / "compose.env"), "config": {str(env): hashlib.sha256(env.read_bytes()).hexdigest()}}
            host = SimpleNamespace(ROOT=root, STATE=root / "state.json", JOURNAL=root / "journal.json",
                layout=layout, idle=lambda: None, health=lambda *_: None, compose=compose,
                container=lambda _: {"Config": {"Env": live["env"]}}, summary=lambda state: {},
                cloud_write=lambda *_: None, read=lambda path: json.loads(path.read_text()),
                write=lambda path, data: path.write_text(json.dumps(data)))
            revision = "1" * 40
            host.write(host.STATE, {"services": {"worker": {"sha": revision}}, "layout": layout(), "html": "unchanged"})
            with patch.object(configure, "durable_replace", lambda path, body: path.write_bytes(body)):
                with self.assertRaisesRegex(RuntimeError, "candidate unhealthy"):
                    configure.configure(host, revision, True)
                self.assertEqual(env.read_bytes(), original)
                configure.configure(host, revision, True)
                self.assertEqual(env.read_bytes(), original + configure.BLOCK)
                self.assertEqual(host.read(host.STATE)["layout"], layout())
                configure.configure(host, revision, True)
                configure.configure(host, revision, False)
                self.assertEqual(env.read_bytes(), original)
            with self.assertRaises(ValueError):
                configure.planned(b"AI_KNOWLEDGE_MAINTENANCE_PAYER=user:another\n", True)
