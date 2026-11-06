import pathlib,sys,tempfile,os,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT));import controls as C
class ReviewFixes(unittest.TestCase):
    def test_F01_final_uid_can_traverse_dev_and_etc(self):
        script=(ROOT/'sandbox-root.sh').read_text()
        self.assertIn('chmod 755 "$ROOT/dev" "$ROOT/etc"',script)
        with tempfile.TemporaryDirectory()as d:
            before=os.umask(0o077)
            try:
                for n in ('dev','etc'):
                    p=pathlib.Path(d)/n;p.mkdir();self.assertEqual(p.stat().st_mode&0o777,0o700);p.chmod(0o755);self.assertTrue(p.stat().st_mode&0o001)
            finally:os.umask(before)
    def test_F02_workflow_has_no_repository_variable_dependency(self):
        p=ROOT.parents[2]/'.github/workflows/preview-variant-offline.yml.disabled';s=p.read_text();self.assertNotIn('vars.',s);self.assertIn('EXPECTED_SHA: ${{ github.event.pull_request.head.sha }}',s);self.assertIn('EXPECTED_CONTROL_MANIFEST_SHA256:',s)
    def test_F03_always_terminal_step(self):
        p=ROOT.parents[2]/'.github/workflows/preview-variant-offline.yml.disabled';s=p.read_text();self.assertIn('if: ${{ always() }}',s);self.assertIn('finalize_terminal.py',s);self.assertTrue((ROOT/'finalize_terminal.py').is_file())
if __name__=='__main__':unittest.main(verbosity=2)
