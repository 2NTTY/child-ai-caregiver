import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[1] / "store.py"
spec = importlib.util.spec_from_file_location("release_store", SOURCE)
store = importlib.util.module_from_spec(spec)
if SOURCE.exists():
    spec.loader.exec_module(store)

BUCKET = "ai-caregivers-for-children-site-release"


class Response:
    def __init__(self, status, data, headers=None):
        self.status = status
        self.data = io.BytesIO(data)
        self.headers = headers or {}

    def read1(self, amount):
        return self.data.read(amount)

    def getheader(self, key, default=None):
        return self.headers.get(key, default)


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.responses = []
        self.requests = []
        outer = self

        class Connection:
            sock = None

            def __init__(self, host, **kwargs):
                self.host = host
                self.kwargs = kwargs

            def request(self, method, path, body=None, headers=None):
                outer.requests.append((self.host, method, path, body, headers, self.kwargs))

            def getresponse(self):
                return outer.responses.pop(0)

            def close(self):
                pass

        self.env = patch.dict(os.environ, {"SITE_ACCESS_TOKEN": "test-sensitive-token"})
        self.env.start()
        self.addCleanup(self.env.stop)
        for kind in ("HTTPSConnection", "HTTPConnection"):
            transport = patch.object(store.http.client, kind, Connection)
            transport.start()
            self.addCleanup(transport.stop)

    def client(self):
        return store.Client(BUCKET)

    def test_get_preserves_json_bytes_and_encodes_object_path(self):
        raw = b'{ "releaseId": "a", "ok": true }\n'
        self.responses = [Response(200, raw)]
        self.assertEqual(self.client().get("commands/current.json"), raw)
        host, method, path, _, headers, options = self.requests[0]
        self.assertEqual(host, "storage.googleapis.com")
        self.assertEqual(method, "GET")
        self.assertEqual(path, "/storage/v1/b/ai-caregivers-for-children-site-release/o/commands%2Fcurrent.json?alt=media")
        self.assertEqual(headers["Authorization"], "Bearer test-sensitive-token")
        self.assertGreater(options["timeout"], 0)
        self.assertLessEqual(options["timeout"], 20)
        self.assertTrue(options["context"].check_hostname)

    def test_get_missing_has_exit_44(self):
        self.responses = [Response(404, b'private error')]
        with self.assertRaises(store.StoreError) as error:
            self.client().get("status/live.json")
        self.assertEqual(error.exception.code, 44)

    def test_read_version_pins_generation_from_metadata(self):
        self.responses = [Response(200, b'{"generation":"123"}'), Response(200, b'{"mode":"auto"}')]
        value = self.client().read_version("control/mode.json")
        self.assertEqual(value, {"generation": "123", "value": {"mode": "auto"}})
        self.assertTrue(self.requests[0][2].endswith("?fields=generation"))
        self.assertTrue(self.requests[1][2].endswith("?alt=media&generation=123"))

    def test_read_version_missing_is_create_only_generation_zero(self):
        self.responses = [Response(404, b'')]
        self.assertEqual(self.client().read_version("control/mode.json"), {"generation": "0", "value": None})

    def test_disappearing_pinned_generation_is_conflict_not_absence(self):
        self.responses = [Response(200, b'{"generation":"123"}'), Response(404, b'')]
        with self.assertRaises(store.StoreError) as error:
            self.client().read_version("control/mode.json")
        self.assertEqual(error.exception.code, 41)

    def test_conditional_put_preserves_payload_and_returns_generation(self):
        self.responses = [Response(200, b'{"generation":"124"}')]
        with tempfile.TemporaryDirectory(dir=SOURCE.parent) as folder:
            source = Path(folder) / "command.json"
            source.write_bytes(b'{ "releaseId": "r-1" }')
            self.assertEqual(self.client().put("commands/current.json", source, "0"), "124")
        self.assertEqual(self.requests[0][1], "POST")
        self.assertEqual(self.requests[0][2], "/upload/storage/v1/b/ai-caregivers-for-children-site-release/o?uploadType=media&name=commands%2Fcurrent.json&ifGenerationMatch=0&fields=generation")
        self.assertEqual(self.requests[0][3], b'{ "releaseId": "r-1" }')

    def test_conditional_put_conflict_is_41_and_does_not_retry(self):
        self.responses = [Response(412, b'secret private error')]
        with tempfile.TemporaryDirectory(dir=SOURCE.parent) as folder:
            source = Path(folder) / "command.json"
            source.write_text('{}')
            with self.assertRaises(store.StoreError) as error:
                self.client().put("commands/current.json", source, "321")
        self.assertEqual(error.exception.code, 41)
        self.assertNotIn("secret", str(error.exception))
        self.assertEqual(len(self.requests), 1)

    def test_redirect_does_not_forward_bearer_token(self):
        self.responses = [Response(302, b'', {"Location": "https://evil.example"})]
        with self.assertRaises(store.StoreError):
            self.client().get("status/live.json")
        self.assertEqual(len(self.requests), 1)

    def test_metadata_token_uses_fixed_link_local_host_and_flavor(self):
        del os.environ["SITE_ACCESS_TOKEN"]
        self.responses = [Response(200, b'{"access_token":"metadata-token"}', {"Metadata-Flavor": "Google"}), Response(200, b'{}')]
        self.assertEqual(self.client().get("status/live.json"), b'{}')
        self.assertEqual(self.requests[0][0], "169.254.169.254")
        self.assertEqual(self.requests[0][4], {"Metadata-Flavor": "Google"})
        self.assertEqual(self.requests[1][4]["Authorization"], "Bearer metadata-token")

    def test_metadata_without_google_flavor_is_rejected(self):
        del os.environ["SITE_ACCESS_TOKEN"]
        self.responses = [Response(200, b'{"access_token":"do-not-trust"}')]
        with self.assertRaises(store.StoreError):
            self.client().get("status/live.json")
        self.assertEqual(len(self.requests), 1)

    def test_invalid_bucket_and_object_fail_before_network(self):
        with self.assertRaises(store.StoreError):
            store.Client("business-data")
        for key in ("", "receipts/../secret.json", "receipts/a/b.json", "receipts/a.json?x", "commands/other.json", "control/secret.json", "status/else.json", "receipts/.json"):
            with self.subTest(key=key), self.assertRaises(store.StoreError):
                self.client().get(key)
        self.assertEqual(self.requests, [])

    def test_malformed_generation_or_json_is_rejected(self):
        for response in (b'{"generation":"0"}', b'{"generation":123}', b'{"generation":"1&x=2"}'):
            self.responses = [Response(200, response)]
            with self.subTest(response=response), self.assertRaises(store.StoreError):
                self.client().read_version("control/mode.json")
        self.responses = [Response(200, b'{"token":NaN}')]
        with self.assertRaises(store.StoreError):
            self.client().get("status/live.json")

    def test_oversize_reply_is_rejected(self):
        self.responses = [Response(200, b' ' * (1024 * 1024 + 1))]
        with self.assertRaises(store.StoreError):
            self.client().get("status/live.json")

    def test_deadline_expires_before_network(self):
        client = self.client()
        with patch.object(store.time, "monotonic", return_value=client.deadline + 1):
            with self.assertRaises(store.StoreError):
                client.get("status/live.json")
        self.assertEqual(self.requests, [])

    def test_invalid_generation_and_invalid_upload_are_rejected_before_network(self):
        with tempfile.TemporaryDirectory(dir=SOURCE.parent) as folder:
            source = Path(folder) / "command.json"
            source.write_bytes(b'{"bad":NaN}')
            for expected in ("1&other=2", "-1", "01", "0"):
                with self.subTest(expected=expected), self.assertRaises(store.StoreError):
                    self.client().put("commands/current.json", source, expected)
        self.assertEqual(self.requests, [])

    def test_transport_exception_does_not_disclose_token_or_private_error(self):
        with patch.object(store.http.client, "HTTPSConnection", side_effect=OSError("test-sensitive-token private body")):
            with self.assertRaises(store.StoreError) as error:
                self.client().get("status/live.json")
        self.assertNotIn("test-sensitive-token", str(error.exception))
        self.assertNotIn("private body", str(error.exception))


if __name__ == "__main__":
    unittest.main()
