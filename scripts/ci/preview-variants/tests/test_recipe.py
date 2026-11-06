"""Static recipe checks. These do not establish OS isolation or product success."""
import ast,pathlib,re,sys,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
class Recipe(unittest.TestCase):
    def test_all_python_parses_without_execution(self):
        for p in ROOT.rglob('*.py'):ast.parse(p.read_text(),filename=p.name)
    def test_install_recipe_keeps_all_lifecycle_disabled(self):
        s=(ROOT/'prepare.py').read_text();self.assertIn("'--ignore-scripts'",s);self.assertIn("'ci',*flags",s);self.assertIn("*flags,'npm@11.8.0'",s);self.assertNotIn('npm rebuild',s);self.assertNotIn('patch-package',s)
    def test_offline_mounts_do_not_include_home_or_credentials(self):
        s=(ROOT/'sandbox-root.sh').read_text();self.assertIn('--bounding-set=-all',s);self.assertIn('mount --make-rprivate /',s);self.assertIn('"$ROOT/project/frontend/dist"',s);self.assertIn('"$ROOT/project/frontend/.expo"',s)
        for path in ('/home/runner','/run/docker.sock','/var/run','GITHUB_TOKEN','ACTIONS_RUNTIME_TOKEN'):self.assertNotIn(path,s)
    def test_network_pid_mount_entry_and_no_global_cleanup(self):
        s=(ROOT/'launch-offline.sh').read_text();self.assertIn('--mount --net --pid --fork --kill-child=KILL',s);self.assertNotIn('rm -rf',s);self.assertNotIn('pkill',s)
    def test_actual_node_module_resolution_is_recorded(self):
        self.assertTrue((ROOT/'resolve-tools.cjs').exists())
        self.assertIn('tool-resolution.json',(ROOT/'runner.py').read_text())
    def test_harbour_evidence_dir_is_unconditional(self):
        s=(ROOT/'runner.py').read_text();self.assertIn("evidence=new_dir(d,'evidence')",s);self.assertIn('INTEGRATION_EVIDENCE=str(evidence)',s);self.assertIn("check_semantic_evidence(variant,stage['id'],evidence)",s)
if __name__=='__main__':unittest.main(verbosity=2)
