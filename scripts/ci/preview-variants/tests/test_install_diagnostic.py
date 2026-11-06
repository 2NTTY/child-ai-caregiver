"""Only synthetic private logs. Never install dependencies or emit raw diagnostics."""
import hashlib,json,pathlib,sys,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
import terminal_receipt as T
import test_terminal_integration as fixtures

class InstallDiagnostic(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.setup=pathlib.Path(self.tmp.name);(self.setup/'locked-install').mkdir()
        self.file=self.setup/'locked-install/output.raw'
    def terminal(self,raw):
        self.file.write_bytes(raw)
        return {'exitCode':1,'rawLog':{'path':'output.raw','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}}
    def call(self,raw,terminal=None):
        t=self.terminal(raw) if terminal is None else terminal
        self.assertTrue(callable(getattr(T,'locked_install_diagnostic',None)),'missing bounded install diagnostic')
        return T.locked_install_diagnostic(self.setup,t)
    def assert_safe(self,r,status,code=None):
        self.assertEqual(r,{'scope':'observed-npm-code-not-root-cause','status':status,'code':code})
    def test_exact_known_code_drops_surrounding_private_text(self):
        raw=b'PRIVATE_USER /private/path https://private.invalid\nnpm error code EFBIG\nnpm error PRIVATE_BODY\n'
        r=self.call(raw);self.assert_safe(r,'recognized','EFBIG');self.assertNotIn('PRIVATE',json.dumps(r))
    def test_all_admitted_codes_are_fixed_not_arbitrary(self):
        for code in ('EUSAGE','ERESOLVE','EINTEGRITY','EFBIG','ENOSPC','EACCES','EPERM','ENOENT','E401','E403','E404','ETIMEDOUT','ECONNRESET','ENOTFOUND','EAI_AGAIN'):
            with self.subTest(code=code):self.assert_safe(self.call(('npm error code '+code+'\n').encode()),'recognized',code)
    def test_unknown_or_malformed_or_control_bearing_lines_are_not_admitted(self):
        for raw in (b'npm error code SECRET\n',b'npm error code EFBIG SECRET\n',b' npm error code EFBIG\n',b'prefix npm error code EFBIG\n',b'npm error code EFBIG\x1b[0m\n',b'npm error code EFBIG\r\n',b'npm error code EFBIG\x00\n',b'npm error code EFBIG',b'npm error code \xff\n',b'npm error PRIVATE\n',b''):
            with self.subTest(raw=repr(raw)):self.assert_safe(self.call(raw),'unknown')
    def test_duplicate_conflicting_or_unknown_extra_code_lines_are_ambiguous(self):
        for second in (b'EFBIG',b'ENOSPC',b'SECRET',b'EFBIG SECRET'):
            self.assert_safe(self.call(b'npm error code EFBIG\nnpm error code '+second+b'\n'),'ambiguous')
    def test_incomplete_trailing_code_marker_cannot_hide_a_second_code(self):
        self.assert_safe(self.call(b'npm error code EFBIG\nnpm error code ENOSPC'),'ambiguous')
    def test_missing_log_and_symlink_are_unavailable(self):
        t=self.terminal(b'npm error code EFBIG\n');self.file.unlink();self.assert_safe(self.call(b'',t),'unavailable')
        target=self.setup/'private';target.write_bytes(b'npm error code EFBIG\n');self.file.symlink_to(target);self.assert_safe(self.call(b'',t),'unavailable')
    def test_hash_size_name_and_boolean_metadata_mismatches_are_unavailable(self):
        for key,val in (('sha256','0'*64),('sha256','SECRET'),('bytes',True),('bytes',1),('path','../private')):
            t=self.terminal(b'npm error code EFBIG\n');t['rawLog'][key]=val;self.assert_safe(self.call(b'',t),'unavailable')
    def test_invalid_zero_or_boolean_exit_does_not_localize_failure(self):
        for code in (False,True,None,'1',0,1.0,256,-256):
            t=self.terminal(b'npm error code EFBIG\n');t['exitCode']=code;self.assert_safe(self.call(b'',t),'unavailable')
    def test_scan_cap_never_admits_a_code_from_a_partial_scan(self):
        raw=b'npm error code EFBIG\n'+b'x'*(256*1024)
        self.assert_safe(self.call(raw),'truncated')
    def test_supervisor_file_cap_is_unavailable_not_read_or_recognized(self):
        t=self.terminal(b'npm error code EFBIG\n')
        with self.file.open('ab')as f:f.truncate(32*1024*1024+1)
        self.assert_safe(self.call(b'',t),'unavailable')
    def test_repeat_calls_are_read_only_and_do_not_retain_previous_code(self):
        raw=b'npm error code EFBIG\n';t=self.terminal(raw)
        a=self.call(b'',t);b=self.call(b'',t);self.assertEqual(a,b);self.assertEqual(self.file.read_bytes(),raw)
        self.assert_safe(self.call(b'npm error code SECRET\n'),'unknown');self.assert_safe(a,'recognized','EFBIG')

class InstallDiagnosticIntegration(unittest.TestCase):
    def setUp(self):
        self.fixture=fixtures.TerminalIntegration(methodName='test_synthetic_complete_receipt_preserves_required_evidence');self.fixture.setUp();self.addCleanup(self.fixture.doCleanups)
    def setup_failed_install(self,raw=b'npm error code EFBIG\n'):
        f=self.fixture;f.outcomes.update(setup='failure',offline='skipped')
        f.put(f.work/'setup-progress.json',{'phase':'locked-install','completed':T.SETUP[:-1]})
        (f.work/'runner-progress.json').unlink();t=f.process();t['exitCode']=1;t['rawLog']={'path':'output.raw','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
        f.put(f.area/'setup/locked-install/terminal.json',t);f.put_bytes(f.area/'setup/locked-install/output.raw',raw)
    def test_failed_install_exposes_only_code_and_preserves_nonzero_fail(self):
        self.setup_failed_install();r=self.fixture.collect();self.assertEqual(r.get('lockedInstallDiagnostic'),{'scope':'observed-npm-code-not-root-cause','status':'recognized','code':'EFBIG'})
        self.assertEqual(r['status'],'FAIL');self.assertEqual(r['reason'],'setup_failed');self.assertFalse(r['evidenceComplete']);self.assertEqual(T.terminal_exit_code(T.bounded_emit(r)),1)
    def test_success_is_unchanged_and_ignores_unrelated_npm_log_text(self):
        f=self.fixture;f.put_bytes(f.area/'setup/locked-install/output.raw',b'npm error code EFBIG\nSECRET')
        r=f.collect();self.assertEqual(r['status'],'PASS');self.assertTrue(r['evidenceComplete']);self.assertIsNone(r.get('lockedInstallDiagnostic'))
    def test_missing_failed_process_does_not_read_or_report_unrelated_text(self):
        self.setup_failed_install();(self.fixture.area/'setup/locked-install/terminal.json').unlink();r=self.fixture.collect()
        self.assertIsNone(r.get('lockedInstallDiagnostic'));self.assertNotEqual(r['status'],'PASS')
    def test_truncation_and_unknown_remain_failure_without_raw_content(self):
        self.setup_failed_install(b'npm error code PRIVATE_SECRET\n');r=self.fixture.collect();self.assertEqual(r.get('lockedInstallDiagnostic',{}).get('status'),'unknown');self.assertNotIn('PRIVATE_SECRET',T.bounded_emit(r));self.assertFalse(r['evidenceComplete'])

if __name__=='__main__':unittest.main(verbosity=2)
