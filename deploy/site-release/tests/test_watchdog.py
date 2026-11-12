import unittest
from datetime import datetime, timezone
from unittest.mock import Mock

from watchdog import DispatchRejected, GitHub, PATH, REPO_ID, check


def instant(value):
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


class MissingSchedule(unittest.TestCase):
    def setUp(self):
        self.github = Mock()
        self.github.timer_state.return_value = "absent"
        self.claim = Mock(return_value=True)
        self.result = Mock()
        self.now = instant("2026-11-12T22:27:00")

    def run_check(self, execute=True, at=None):
        return check(at or self.now, self.github, self.claim, self.result, execute)

    def test_only_checks_the_current_due_slot_after_grace(self):
        for at in ("2026-11-12T17:00:00", "2026-11-12T22:16:59", "2026-11-13T01:00:00"):
            self.assertEqual(self.run_check(at=instant(at))["state"], "outside-window")
        self.github.timer_state.assert_not_called()
        self.assertEqual(self.run_check(False)["state"], "would-dispatch")
        self.claim.assert_not_called()
        self.github.dispatch.assert_not_called()
        for observed in ("scheduled", "inactive", "in-progress"):
            self.github.timer_state.return_value = observed
            self.assertEqual(self.run_check()["state"], observed)
        self.claim.assert_not_called()

    def test_duplicate_and_unknown_never_dispatch_twice(self):
        self.claim.side_effect = (True, False)
        self.github.dispatch.side_effect = TimeoutError("transport")
        with self.assertRaisesRegex(RuntimeError, "original"):
            self.run_check()
        self.result.assert_called_once_with("2026-11-12", "unknown", None)
        self.assertEqual(self.run_check()["state"], "already-claimed")
        self.github.dispatch.assert_called_once_with("2026-11-12")

    def test_real_dispatch_needs_one_claim_and_records_the_run(self):
        self.github.dispatch.return_value = 12345
        outcome = self.run_check()
        self.assertEqual(outcome, {"state": "dispatched", "slot": "2026-11-12", "runId": 12345})
        self.claim.assert_called_once_with("2026-11-12")
        self.result.assert_called_once_with("2026-11-12", "dispatched", 12345)

    def test_rejected_dispatch_keeps_the_original_claim(self):
        self.github.dispatch.side_effect = DispatchRejected("HTTP 403")
        with self.assertRaisesRegex(DispatchRejected, "403"):
            self.run_check()
        self.result.assert_called_once_with("2026-11-12", "rejected", None)

    def test_operator_recovery_counts_for_its_slot_but_not_as_a_native_timer(self):
        github = GitHub()
        workflow = {"id": 123, "path": ".github/workflows/site-release.yml", "state": "active"}
        recovered = {"status": "completed", "event": "workflow_dispatch", "head_branch": "master",
                     "display_title": "Daily website catch-up 2026-11-12", "workflow_id": 123,
                     "head_repository": {"id": REPO_ID}, "created_at": "2026-11-12T22:22:06Z"}
        for title, state in ((recovered["display_title"], "already-dispatched"),
                             ("Daily website catch-up 2026-11-11", "absent")):
            github.request = Mock(side_effect=(workflow, {"workflow_runs": []},
                                               {"total_count": 1, "workflow_runs": [dict(recovered, display_title=title)]}))
            self.assertEqual(github.timer_state(instant("2026-11-12T20:17:00")), state)

    def test_queries_real_workflow_provenance_and_dispatches_only_fixed_master(self):
        github = GitHub()
        workflow = {"id": 123, "path": ".github/workflows/site-release.yml", "state": "active"}
        event = {"workflow_id": 123, "head_repository": {"id": REPO_ID}, "head_branch": "master",
                 "event": "schedule", "created_at": "2026-11-12T20:20:00Z"}
        github.request = Mock(side_effect=(workflow, {"workflow_runs": [event]}))
        self.assertEqual(github.timer_state(instant("2026-11-12T20:17:00")), "scheduled")
        github.request = Mock(return_value={"workflow_run_id": 71234})
        github.token = "synthetic"
        self.assertEqual(github.dispatch("2026-11-12"), 71234)
        github.request.assert_called_once_with(PATH + "/dispatches",
            {"ref": "master", "inputs": {"operation": "catchup", "slot": "2026-11-12"}}, "synthetic")
