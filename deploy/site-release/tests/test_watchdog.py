import unittest
from datetime import datetime, timezone
from unittest.mock import Mock

from watchdog import DispatchRejected, GitHub, PATH, check


def instant(value):
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


class DailySchedule(unittest.TestCase):
    def setUp(self):
        self.github = Mock()
        self.claim = Mock(return_value=True)
        self.result = Mock()
        self.now = instant("2026-11-12T22:27:00")

    def run_check(self, execute=True, at=None):
        return check(at or self.now, self.github, self.claim, self.result, execute)

    def test_dispatches_at_0417_hong_kong_without_waiting_for_github(self):
        for at in ("2026-11-12T17:00:00", "2026-11-12T20:16:59", "2026-11-13T01:00:00"):
            self.assertEqual(self.run_check(at=instant(at))["state"], "outside-window")
        self.assertEqual(self.run_check(False)["state"], "would-dispatch")
        self.claim.assert_not_called()
        self.github.dispatch.assert_not_called()
        self.assertEqual(self.run_check(at=instant("2026-11-12T20:17:00"))["state"], "dispatched")
        self.github.dispatch.assert_called_once_with("2026-11-12")
        self.github.timer_state.assert_not_called()

    def test_duplicate_and_unknown_never_dispatch_twice(self):
        self.claim.side_effect = (True, False)
        self.github.dispatch.side_effect = TimeoutError("transport")
        with self.assertRaisesRegex(RuntimeError, "original"):
            self.run_check()
        self.result.assert_called_once_with("2026-11-12", "unknown", None)
        self.assertEqual(self.run_check()["state"], "already-claimed")
        self.github.dispatch.assert_called_once_with("2026-11-12")

    def test_early_acceptance_does_not_reuse_or_replace_regular_slot(self):
        slot = instant("2026-11-12T23:38:00")
        at = instant("2026-11-12T23:42:00")
        self.github.dispatch.return_value = 7
        self.assertEqual(check(at, self.github, self.claim, self.result, True, slot)["slot"], "2026-11-12T23-38Z")
        self.github.dispatch.assert_called_once_with("2026-11-12T23-38Z")
        next_day = instant("2026-11-13T22:27:00")
        self.assertEqual(check(next_day, self.github, self.claim, self.result, False, slot)["slot"], "2026-11-13")

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

    def test_dispatches_only_the_official_workflow_on_fixed_master(self):
        github = GitHub()
        github.request = Mock(return_value={"workflow_run_id": 71234})
        github.token = "synthetic"
        self.assertEqual(github.dispatch("2026-11-12"), 71234)
        github.request.assert_called_once_with(PATH + "/dispatches",
            {"ref": "master", "inputs": {"operation": "daily", "slot": "2026-11-12"}}, "synthetic")
