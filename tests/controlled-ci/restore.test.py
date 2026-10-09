import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).parents[2]
spec = importlib.util.spec_from_file_location('controlled_restore', ROOT / 'scripts/controlled-ci/restore-checkpoint.py')
restore_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore_module)
INITIAL = (ROOT / '.github/controlled-model/initial-live-ledger.json').read_bytes()

class RestoreTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='controlled-restore-test-')
        self.base = Path(self.temporary.name)
        self.workspace, self.temp = self.base / 'workspace', self.base / 'temp'
        for directory in (self.workspace, self.temp, self.workspace / 'trusted', self.workspace / 'product', self.temp / 'controlled-model-control'):
            directory.mkdir()
        self.plan = {'schemaVersion': 1, 'ledgerSha256': restore_module.INITIAL_SHA,
                     'checkpointSource': {'type': 'initial', 'path': restore_module.INITIAL_PATH, 'sha256': restore_module.INITIAL_SHA},
                     'runId': 'synthetic_restore_run', 'case': 'B', 'expiresAt': '2026-10-09T23:00:00Z'}
    def tearDown(self):
        self.temporary.cleanup()
    def write_plan(self):
        (self.temp / 'controlled-model-control/restore-plan.json').write_text(json.dumps(self.plan))
    def set_archive(self, files):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name, data in files:
                archive.writestr(name, data)
        data = output.getvalue()
        directory = self.temp / 'controlled-model-download'
        directory.mkdir()
        (directory / 'synthetic.zip').write_bytes(data)
        self.plan['checkpointSource'] = {'type': 'artifact', 'artifactDigest': 'sha256:' + hashlib.sha256(data).hexdigest()}
        self.write_plan()
    def test_exact_root_initial_checkpoint_is_copied_outside_both_checkouts(self):
        filename = self.workspace / 'trusted' / restore_module.INITIAL_PATH
        filename.parent.mkdir(parents=True)
        filename.write_bytes(INITIAL)
        self.write_plan()
        report = restore_module.restore(str(self.workspace), str(self.temp))
        target = self.workspace / '.controlled-model-state/live-ledger.json'
        self.assertEqual(target.read_bytes(), INITIAL)
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
        self.assertFalse(report['checkpointConsumed'])
        self.assertEqual(filename.read_bytes(), INITIAL)
    def test_verified_raw_zip_restores_only_the_approved_ledger(self):
        self.set_archive([('live-ledger.json', INITIAL), ('result.json', b'{"mode":"live","semantic":{"status":"root_review_required"}}')])
        report = restore_module.restore(str(self.workspace), str(self.temp))
        self.assertEqual(report['checkpointSha256'], restore_module.INITIAL_SHA)
        self.assertEqual((self.workspace / '.controlled-model-state/live-ledger.json').read_bytes(), INITIAL)
    def test_path_traversal_unlisted_files_and_duplicate_names_are_refused(self):
        for bad_name in ('../escape.json', '/absolute.json', 'gha-creds.json', 'nested/live-ledger.json'):
            with self.subTest(name=bad_name):
                with tempfile.TemporaryDirectory() as isolated:
                    self.set_archive([('live-ledger.json', INITIAL), (bad_name, b'{}')])
                    with self.assertRaises(restore_module.RestoreError):
                        restore_module.restore(str(self.workspace), str(self.temp))
                    for file in (self.temp / 'controlled-model-download').iterdir(): file.unlink()
                    (self.temp / 'controlled-model-download').rmdir()
    def test_archive_digest_mismatch_refuses_state_creation(self):
        self.set_archive([('live-ledger.json', INITIAL)])
        self.plan['checkpointSource']['artifactDigest'] = 'sha256:' + '0' * 64
        self.write_plan()
        with self.assertRaisesRegex(restore_module.RestoreError, 'archive_digest_mismatch'):
            restore_module.restore(str(self.workspace), str(self.temp))
        self.assertFalse((self.workspace / '.controlled-model-state').exists())
    def test_symlink_zip_entry_and_zip_bomb_are_refused_before_read(self):
        directory = self.temp / 'controlled-model-download'
        directory.mkdir()
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as archive:
            info = zipfile.ZipInfo('live-ledger.json')
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(info, '../synthetic')
        data = output.getvalue()
        (directory / 'synthetic.zip').write_bytes(data)
        self.plan['checkpointSource'] = {'type': 'artifact', 'artifactDigest': 'sha256:' + hashlib.sha256(data).hexdigest()}
        self.write_plan()
        with self.assertRaisesRegex(restore_module.RestoreError, 'archive_filename_or_type_denied'):
            restore_module.restore(str(self.workspace), str(self.temp))
        (directory / 'synthetic.zip').unlink(); directory.rmdir()
        self.set_archive([('live-ledger.json', b' ' * (restore_module.MAX_LEDGER + 1))])
        with self.assertRaisesRegex(restore_module.RestoreError, 'archive_size_or_encryption_denied'):
            restore_module.restore(str(self.workspace), str(self.temp))
    def test_sensitive_fields_and_checkpoint_hash_mismatch_do_not_restore(self):
        self.set_archive([('live-ledger.json', b'{"Token":"SYNTHETIC_PRIVATE_VALUE"}')])
        with self.assertRaisesRegex(restore_module.RestoreError, 'checkpoint_sensitive_field_denied'):
            restore_module.restore(str(self.workspace), str(self.temp))
        self.assertFalse((self.workspace / '.controlled-model-state').exists())
    def test_existing_state_symlink_is_not_followed(self):
        filename = self.workspace / 'trusted' / restore_module.INITIAL_PATH
        filename.parent.mkdir(parents=True); filename.write_bytes(INITIAL)
        self.write_plan()
        elsewhere = self.base / 'elsewhere'; elsewhere.mkdir()
        (self.workspace / '.controlled-model-state').symlink_to(elsewhere, target_is_directory=True)
        with self.assertRaises(Exception):
            restore_module.restore(str(self.workspace), str(self.temp))
        self.assertEqual(list(elsewhere.iterdir()), [])

if __name__ == '__main__':
    unittest.main()
