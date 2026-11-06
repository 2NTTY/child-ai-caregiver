import importlib.util,pathlib,sys,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT));import controls as C
S=importlib.util.spec_from_file_location('assemble',ROOT/'assemble.py')if(ROOT/'assemble.py').exists()else None
A=importlib.util.module_from_spec(S)if S else None
if S:S.loader.exec_module(A)
class Patch(unittest.TestCase):
    def api(self):self.assertTrue(A is not None,'missing strict delta implementation');return A.exact_patch
    def fixture(self):
        self.t=tempfile.TemporaryDirectory();self.addCleanup(self.t.cleanup);p=pathlib.Path(self.t.name);(p/'x').write_bytes(b'a\nb\nc\n');return p
    def test_exact_context_applies(self):
        p=self.fixture();self.api()(p,b'--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n',[{'path':'x','origin':'replace'}]);self.assertEqual((p/'x').read_bytes(),b'a\nB\nc\n')
    def test_wrong_offset_refused(self):
        p=self.fixture()
        with self.assertRaises(C.Refused):self.api()(p,b'--- a/x\n+++ b/x\n@@ -2,3 +2,3 @@\n a\n-b\n+B\n c\n',[{'path':'x','origin':'replace'}])
    def test_fuzz_truncation_unknown_target_escape_refused(self):
        f=self.api();good=b'--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n'
        for bad in (good.replace(b' a\n',b' Z\n'),good[:-1],good.replace(b'+++ b/x',b'+++ b/y'),good.replace(b'--- a/x',b'--- a/../x')):
            p=self.fixture()
            with self.subTest(bad=bad),self.assertRaises(C.Refused):f(p,bad,[{'path':'x','origin':'replace'}])
    def test_add_new_file(self):
        p=self.fixture();self.api()(p,b'--- /dev/null\n+++ b/y\n@@ -0,0 +1 @@\n+new\n',[{'path':'y','origin':'add'}]);self.assertEqual((p/'y').read_bytes(),b'new\n')
    def test_duplicate_target_refused(self):
        p=self.fixture();d=b'--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n'
        with self.assertRaises(C.Refused):self.api()(p,d+d,[{'path':'x','origin':'replace'}])
if __name__=='__main__':unittest.main(verbosity=2)
