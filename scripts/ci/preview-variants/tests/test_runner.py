import importlib.util,pathlib,sys,tempfile,unittest,os,json
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT));import controls as C
S=importlib.util.spec_from_file_location('runner',ROOT/'runner.py')if(ROOT/'runner.py').exists()else None
R=importlib.util.module_from_spec(S)if S else None
if S:S.loader.exec_module(R)
class Runner(unittest.TestCase):
    def api(self,name):self.assertTrue(R is not None and callable(getattr(R,name,None)),'missing runner '+name);return getattr(R,name)
    def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name)
    def test_harbour_evidence_missing_file_is_refusal(self):
        f=self.api('check_semantic_evidence');(self.root/'actual-retirement.json').write_text('{}')
        with self.assertRaises(C.Refused):f('harbour','collector',self.root)
        (self.root/'concurrent-completion.json').write_text('{}');f('harbour','collector',self.root)
    def test_harbour_unexpected_evidence_is_refusal(self):
        f=self.api('check_semantic_evidence');(self.root/'unknown.json').write_text('{}')
        with self.assertRaises(C.Refused):f('harbour','facade',self.root)
    def test_synthetic_process_receipt(self):
        f=self.api('supervise');r=f([sys.executable,'-c','print("synthetic-control")'],self.root,{'PATH':'/usr/bin:/bin'},self.root,2)
        self.assertEqual(r['exitCode'],0);self.assertTrue(r['groupEmpty']);self.assertTrue(r['allOwnedReaped']);self.assertEqual(r['argv'][1],'-c');self.assertTrue((self.root/'output.raw').exists())
    def test_synthetic_timeout_reaped(self):
        f=self.api('supervise');r=f([sys.executable,'-c','import time; time.sleep(10)'],self.root,{'PATH':'/usr/bin:/bin'},self.root,0.05)
        self.assertTrue(r['timedOut']);self.assertNotEqual(r['exitCode'],0);self.assertTrue(r['groupEmpty']);self.assertTrue(r['allOwnedReaped'])
    def test_isolation_contract_missing_env_refused(self):
        f=self.api('isolation_contract')
        with self.assertRaises(C.Refused):f({})
    def test_output_census_rejects_symlink(self):
        f=self.api('bundle_census');(self.root/'index.html').write_text('<html/>');(self.root/'bad.js').symlink_to('/etc/passwd')
        with self.assertRaises(C.Refused):f(self.root)
if __name__=='__main__':unittest.main(verbosity=2)
