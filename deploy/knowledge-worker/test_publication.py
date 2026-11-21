import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import publication


class PublicationTests(unittest.TestCase):
    def test_script_command_requires_the_version_in_the_published_worker(self):
        row = {"sourceId": "fhs-30119", "observationHash": "a" * 64}
        args = SimpleNamespace(action="script", mode="run", source=row["sourceId"], observation=row["observationHash"], reads=None)
        self.assertEqual(list(publication.commands(args, [row])), [
            ["scripts/fhs-initial-campaign.mjs", "publish-script-edition", args.source, args.observation]])
        args.mode = "revise"
        self.assertEqual(list(publication.commands(args, [row])), [
            ["scripts/fhs-initial-campaign.mjs", "revise-script-edition", args.source, args.observation]])
        args.observation = "b" * 64
        with self.assertRaisesRegex(ValueError, "Unassigned script edition"):
            list(publication.commands(args, [row]))

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
        with patch("publication.Path.read_text", return_value=f"MemAvailable: {741 * 1024} kB\n"), patch("publication.subprocess.Popen") as run:
            proc = run.return_value.__enter__.return_value
            proc.wait.return_value = 0
            self.assertEqual(publication.compose_job(self.host, self.args, command), (0, None))
        docker, = run.call_args.args
        self.assertIn("--no-deps", docker)
        self.assertIn("--rm", docker)
        self.assertEqual(docker[docker.index("--name")+1], "yuban-fhs-publication")
        self.assertEqual(docker[-3:], ["publication", *command])
        self.assertIn('node "$@"', docker[docker.index("-c")+1])
        overlay = json.loads(proc.stdin.write.call_args.args[0])
        self.assertEqual(set(overlay["services"]), {"worker"})
        worker = overlay["services"]["worker"]
        self.assertEqual((worker["cpus"], worker["mem_limit"], worker["memswap_limit"]), (0.5, "288m", "288m"))
        self.assertEqual(worker["image"], "backend@sha256:fixed")
        self.assertEqual(worker["healthcheck"], {"disable": True})
        self.assertEqual(worker["volumes"], ["fhs_publication_cache:/var/tmp/yuban-knowledge:ro"])
        self.assertEqual(overlay["volumes"]["fhs_publication_cache"], {"external": True, "name": "existing"})

    def test_unhealthy_site_stops_before_container_creation(self):
        self.host.url.return_value = '{"status":"unhealthy"}'
        with patch("publication.subprocess.Popen") as run:
            with self.assertRaisesRegex(RuntimeError, "not healthy"):
                publication.compose_job(self.host, self.args, [])
            run.assert_not_called()

    def test_701_mib_waits_then_dispatches_once_with_the_prepared_original(self):
        args = SimpleNamespace(action="lane", lane="C1", reads=None)
        op = "a"*64
        command = ["scripts/fhs-initial-campaign.mjs", "publish-approved", "resource-af8c3e8cc813be"]
        readings = iter([701, 698, 704, 702, 712, 710])
        with patch("publication.Path.read_text", side_effect=lambda: f"MemAvailable: {next(readings)*1024} kB\n"), \
                patch("time.sleep") as sleep, patch("publication.subprocess.Popen") as create:
            sleep.side_effect = lambda seconds: create.assert_not_called()
            proc = create.return_value.__enter__.return_value
            proc.wait.return_value = 0
            self.assertEqual(publication.compose_job(self.host, args, command, original=op), (0,None))
            self.assertEqual(sleep.call_count, 3)
            self.assertEqual(self.host.url.call_count, 3)
            create.assert_called_once()
            worker = json.loads(proc.stdin.write.call_args.args[0])["services"]["worker"]
            self.assertEqual(worker["mem_limit"], "256m")
            self.assertEqual(worker["environment"]["FHS_CAMPAIGN_ORIGINAL_OPERATION"], op)

    def test_release_started_while_waiting_leaves_the_original_undispatched(self):
        with patch("publication.Path.read_text", return_value="MemAvailable: 717824 kB\n"), \
                patch("time.sleep") as sleep, patch("publication.subprocess.Popen") as create:
            sleep.side_effect = lambda seconds: setattr(self.host.JOURNAL.exists, "return_value", True)
            with self.assertRaisesRegex(RuntimeError, "release"):
                publication.compose_job(self.host, self.args, ["scripts/fhs-initial-campaign.mjs","status"])
            create.assert_not_called()

    def test_a_larger_original_yields_when_only_smaller_jobs_still_fit(self):
        state = self.host.read.return_value
        with patch("publication.Path.read_text", return_value=f"MemAvailable: {717*1024} kB\n"), \
                patch("time.monotonic", side_effect=[0, 10, 20, 30]), patch("time.sleep") as sleep:
            with self.assertRaisesRegex(publication.OriginalCapacityError, "272 MiB job"):
                publication.capacity_for_phase(self.host, state, 12*1048576)
            self.assertEqual(sleep.call_count, 3)

    def test_large_original_stops_before_dispatch_and_small_original_uses_the_existing_binding(self):
        args = SimpleNamespace(action="lane", mode="run", lane="C1", reads=None)
        op = "c"*64
        command = ["scripts/fhs-initial-campaign.mjs", "publish-approved", "resource-af8c3e8cc813be"]
        with patch("publication.Path.read_text", return_value=f"MemAvailable: {741*1024} kB\n"), patch("publication.subprocess.Popen") as run:
            with self.assertRaisesRegex(RuntimeError, "512 MiB job"):
                publication.compose_job(self.host, args, command, original=op, pdf_bytes=40*1048576)
            run.assert_not_called()
            proc = run.return_value.__enter__.return_value
            proc.wait.return_value = 0
            publication.compose_job(self.host, args, command, original=op, pdf_bytes=1048576)
            service = json.loads(proc.stdin.write.call_args.args[0])["services"]["worker"]
            self.assertEqual(service["environment"], {"FHS_CAMPAIGN_LANE":"C1","FHS_CAMPAIGN_ORIGINAL_OPERATION":op})

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
            self.assertEqual(publication.compose_job(self.host, args, command), (2, json.loads(proc.stdout[0])))

    def test_one_source_finishes_preparation_before_its_sole_commissioned_process_starts(self):
        source, op = "resource-af8c3e8cc813be", "a"*64
        args = SimpleNamespace(action="lane", lane="C1", mode="run")
        command = ["scripts/fhs-catalog-batch.mjs", "--lane", "C1", "run", source]
        ready = {"state":"ready", "operationFingerprint":op, "pinned":True, "started":False}
        terminal = {"state":"published", "operationFingerprint":op}
        with patch("publication.compose_job", side_effect=[(0,ready), (0,None), (0,terminal)]) as run:
            self.assertEqual(publication.run_source(self.host, args, command, 1024), (0,"published"))
            jobs = [call.args[2] for call in run.call_args_list]
            self.assertEqual(jobs, [[*command[:3],"prepare",source], ["scripts/fhs-initial-campaign.mjs","publish-approved",source],
                                    [*command[:3],"status",source]])
            self.assertEqual(run.call_args_list[1].kwargs["original"], op)
        with patch("publication.compose_job", return_value=(2,{"state":"source_blocked"})) as run:
            self.assertEqual(publication.run_source(self.host, args, command, 1024), (2,"source_blocked"))
            self.assertEqual(run.call_count, 1)
        with patch("publication.compose_job", side_effect=[(0,ready), publication.OriginalCapacityError("512 MiB job")]) as run:
            self.assertEqual(publication.run_source(self.host, args, command, 64*1048576), (2,"capacity_wait"))
            self.assertEqual(run.call_count, 2)
        with patch("publication.compose_job", side_effect=[(0,{**ready,"started":True}), (3,None),
                                                          (0,{**terminal,"operationFingerprint":"b"*64})]) as run:
            with self.assertRaisesRegex(RuntimeError, "operation"):
                publication.run_source(self.host, args, command, 1024)
            self.assertEqual(run.call_args_list[1].args[2], ["scripts/fhs-initial-campaign.mjs","resume-approved",source,op])

    def test_all_deployed_assignments_and_their_original_receipts_are_addressable(self):
        path = Path(__file__).resolve().parents[2] / "knowledge/fhs-initial-publication-lanes.json"
        manifest = json.loads(path.read_text(encoding="utf8"))
        resource_sources = {"C1": "resource-af8c3e8cc813be", "C3": "resource-1ba127a119f802"}
        for group in manifest["lanes"]:
            args = SimpleNamespace(action="lane", lane=group["id"], mode="run", source=None)
            expected = [row["sourceId"] for row in sorted(group["sources"], key=lambda row: row["pages"])]
            self.assertEqual(len(expected), 28)
            self.assertEqual([cmd[-1] for cmd in publication.commands(args, manifest)], expected)
            if args.lane in resource_sources:
                args.source = resource_sources[args.lane]
                self.assertEqual([cmd[-1] for cmd in publication.commands(args, manifest)], [args.source])
                args.lane = "C2"
                with self.assertRaisesRegex(ValueError, "lane source"):
                    list(publication.commands(args, manifest))
        for action in ("inspect", "receipt"):
            for source in [*resource_sources.values(), publication.CONTINUATION_SOURCE]:
                args = SimpleNamespace(action=action, source=source, original="a"*64, delivery=None)
                cmd, = publication.commands(args, manifest)
                self.assertIn(source, cmd)
            for source in ("resource-00000000000000", "pdf-" + "0"*24):
                args.source = source
                with self.assertRaisesRegex(ValueError, "Unassigned"):
                    list(publication.commands(args, manifest))


if __name__ == "__main__":
    unittest.main()
