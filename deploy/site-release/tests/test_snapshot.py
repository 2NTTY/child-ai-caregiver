import os
from unittest.mock import Mock, patch
import unittest
import controller

class ReleaseSnapshot(unittest.TestCase):
    def test_publish_uses_the_original_snapshot_when_master_moves(self):
        sha="2"*40
        services={name:{"sha":"1"*40,"digest":"sha256:"+"1"*64} for name in ("api","worker","web")}
        state={"sourceSha":sha,"controlGeneration":"1","services":services}
        cloud=Mock()
        cloud.read_version.side_effect=[
            {"generation":"1","value":{"paused":False}},{"value":{"services":services}},
            {"generation":"0","value":None},{"value":{"id":"r123-1","result":"deployed"}}]
        env={"GITHUB_SHA":sha,"GITHUB_RUN_ID":"123","GITHUB_RUN_ATTEMPT":"1","DECISION":"run","WEB":"true","BACKEND":"false"}
        with patch.dict(os.environ,env), patch.object(controller,"Client",return_value=cloud), patch.object(controller,"api",side_effect=AssertionError("branch head consulted")), patch.object(controller,"readfile",side_effect=[state,{"web":"sha256:"+"2"*64}]), patch.object(controller,"put") as submit:
            controller.publish()
        self.assertEqual(submit.call_args.args[2]["target"],sha)
        self.assertEqual(submit.call_args.args[2]["baseline"],services)
