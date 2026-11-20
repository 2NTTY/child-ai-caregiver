import json
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import publication


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.host = Mock()
        layout = {"wd": "/site", "env": "/site/env", "files": ["/site/compose.yml"]}
        self.host.read.return_value = {"layout": layout, "services": {"worker": {"ref": "backend@sha256:fixed"}}}
        self.host.layout.return_value = layout
        self.host.JOURNAL.exists.return_value = False
        self.host.OVERRIDE = "/site/images.json"
        self.host.url.return_value = '{"status":"ok"}'
        self.host.container.return_value = {"Mounts": [{"Destination": publication.CACHE, "Type": "volume", "Name": "existing"}]}
        self.args = SimpleNamespace(action="accounting", reads=None, reads_hash=None)

    def test_job_uses_the_published_image_readonly_volume_and_bounded_container(self):
        command, = publication.commands(self.args, None)
        with patch("publication.Path.read_text", return_value="MemAvailable: 917504 kB\n"), patch("publication.subprocess.Popen") as run:
            proc = run.return_value.__enter__.return_value
            proc.wait.return_value = 0
            self.assertEqual(publication.compose_job(self.host, self.args, command), (0, None))
        docker, = run.call_args.args
        self.assertIn("--no-deps", docker)
        self.assertIn("--rm", docker)
        self.assertEqual(docker[docker.index("--name")+1], "yuban-fhs-publication")
        self.assertEqual(docker[-3:], ["node", *command])
        overlay = json.loads(proc.stdin.write.call_args.args[0])
        self.assertEqual(set(overlay["services"]), {"worker"})
        worker = overlay["services"]["worker"]
        self.assertEqual((worker["cpus"], worker["mem_limit"], worker["memswap_limit"]), (0.5, "512m", "512m"))
        self.assertEqual(worker["image"], "backend@sha256:fixed")
        self.assertEqual(worker["healthcheck"], {"disable": True})
        self.assertEqual(worker["volumes"], ["fhs_publication_cache:/var/tmp/yuban-knowledge:ro"])
        self.assertEqual(overlay["volumes"]["fhs_publication_cache"], {"external": True, "name": "existing"})

    def test_low_headroom_or_unhealthy_site_stops_before_container_creation(self):
        with patch("publication.Path.read_text", return_value="MemAvailable: 917503 kB\n"), patch("publication.subprocess.Popen") as run:
            with self.assertRaisesRegex(RuntimeError, "free memory"):
                publication.compose_job(self.host, self.args, [])
            self.host.url.return_value = '{"status":"unhealthy"}'
            with self.assertRaisesRegex(RuntimeError, "not healthy"):
                publication.compose_job(self.host, self.args, [])
            run.assert_not_called()

    def test_each_assigned_source_gets_a_separate_turn_in_page_order(self):
        short, long = ("pdf-" + digit * 24 for digit in ("1", "2"))
        manifest = {"lanes": [{"id": "C1", "sources": [{"sourceId": long, "pages": 12}, {"sourceId": short, "pages": 3}]}]}
        args = SimpleNamespace(action="lane", lane="C1", mode="run", source=None)
        self.assertEqual([cmd[-1] for cmd in publication.commands(args, manifest)], [short, long])
        args.source = "pdf-" + "3" * 24
        with self.assertRaisesRegex(ValueError, "lane source"):
            list(publication.commands(args, manifest))

    def test_only_the_matching_terminal_lane_receipt_can_quarantine_a_single_source(self):
        source = "pdf-" + "1" * 24
        args = SimpleNamespace(action="lane", lane="C1", mode="run", source=source, reads=None)
        command = ["scripts/fhs-catalog-batch.mjs", "--lane", "C1", "run", source]
        with patch("publication.Path.read_text", return_value="MemAvailable: 917504 kB\n"), patch("publication.subprocess.Popen") as run, patch("builtins.print"):
            proc = run.return_value.__enter__.return_value
            proc.wait.return_value = 2
            proc.stdout = [json.dumps({"lane": "C2", "sourceId": source, "state": "source_blocked"})]
            self.assertEqual(publication.compose_job(self.host, args, command), (2, None))
            proc.stdout = [json.dumps({"lane": "C1", "sourceId": source, "state": "source_blocked"})]
            self.assertEqual(publication.compose_job(self.host, args, command), (2, "source_blocked"))


if __name__ == "__main__":
    unittest.main()
