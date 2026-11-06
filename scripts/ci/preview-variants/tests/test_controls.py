"""Synthetic control tests only; never execute project JS, npm, compiler or Metro."""
import copy, importlib.util, json, os, pathlib, sys, tempfile, unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]; sys.path.insert(0,str(ROOT))
SPEC=importlib.util.spec_from_file_location('controls',ROOT/'controls.py') if (ROOT/'controls.py').exists() else None
C=importlib.util.module_from_spec(SPEC) if SPEC else None
if SPEC: SPEC.loader.exec_module(C)
class Controls(unittest.TestCase):
    def api(self,name):
        self.assertTrue(C is not None and callable(getattr(C,name,None)), 'missing implementation: '+name)
        return getattr(C,name)
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup); self.root=pathlib.Path(self.tmp.name)
    def test_valid_relative_path(self): self.assertEqual(self.api('path_name')('frontend/app/(x)/a.ts'),'frontend/app/(x)/a.ts')
    def test_bad_paths_refused(self):
        f=self.api('path_name')
        for p in ('','/tmp/a','../a','a/../b','a//b','a/./b','C:\\a','x\x00a','.git/config','.npmrc','.env.local','x/.env','a/'):
            with self.subTest(p=p), self.assertRaises(C.Refused): f(p)
    def test_duplicate_rows_refused(self):
        f=self.api('rows');r={'path':'x','bytes':1,'sha256':'a'*64}
        with self.assertRaises(C.Refused):f([r,r])
    def test_parent_file_overlap_refused(self):
        f=self.api('rows')
        with self.assertRaises(C.Refused):f([{'path':p,'bytes':0,'sha256':'a'*64}for p in ('x','x/y')])
    def test_symlink_ancestor_refused(self):
        f=self.api('regular'); (self.root/'real').mkdir();(self.root/'real/x').write_text('x');(self.root/'link').symlink_to('real')
        with self.assertRaises(C.Refused): f(self.root,'link/x')
    def test_new_evidence_dir_absolute_unique_owned(self):
        f=self.api('new_dir');p=f(self.root,'evidence-stage-1');self.assertTrue(p.is_absolute());self.assertEqual(list(p.iterdir()),[])
        with self.assertRaises(C.Refused): f(self.root,'evidence-stage-1')
    def test_evidence_escape_refused(self):
        f=self.api('new_dir')
        with self.assertRaises(C.Refused):f(self.root,'../evil')
    def test_census_unknown_extra_refused(self):
        f=self.api('match');(self.root/'x').write_text('x');r=[C.row('x',b'x')];f(self.root,r);(self.root/'extra').write_text('x')
        with self.assertRaises(C.Refused):f(self.root,r)
    def test_unknown_empty_directory_refused(self):
        f=self.api("match");(self.root/"unknown").mkdir()
        with self.assertRaises(C.Refused):f(self.root,[])
    def test_source_drift_even_with_allowed_outputs(self):
        f=self.api('match');(self.root/'frontend').mkdir();p=self.root/'frontend/x.ts';p.write_text('x');r=[C.row('frontend/x.ts',b'x')]
        (self.root/'node_modules').mkdir();(self.root/'frontend/dist').mkdir();(self.root/'frontend/dist/x.js').write_text('new')
        f(self.root,r,installed=True);p.write_text('y')
        with self.assertRaises(C.Refused):f(self.root,r,installed=True)
    def test_node_modules_root_symlink_refused(self):
        f=self.api('match');(self.root/'outside').mkdir();(self.root/'node_modules').symlink_to('outside')
        with self.assertRaises(C.Refused):f(self.root,[],installed=True)
    def test_program_scope_requires_all_roots(self):
        f=self.api('program_list'); roots=['frontend/app/a.ts','frontend/src/b.tsx'];text='/project/frontend/app/a.ts\n/project/frontend/src/b.tsx\n/toolchain/lib/x.d.ts\nFiles: 3\n'
        self.assertEqual(f(text,roots)['directRoots'],2)
        with self.assertRaises(C.Refused):f(text.replace('/project/frontend/src/b.tsx\n',''),roots)
    def test_compiler_program_keeps_json_and_js_members(self):
        p=self.api("program_list")("/project/frontend/app/a.ts\n/project/frontend/src/data.json\n/project/frontend/src/x.mjs\nFiles: 3\n",["frontend/app/a.ts"])
        self.assertEqual(p["count"],3)
    def test_tap_zero_skip_fail_or_missing_summary_refused(self):
        f=self.api('tap_counts');good='1..2\n# tests 2\n# suites 0\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n'
        self.assertEqual(f(good,2)['tests'],2)
        for bad in (good.replace('# tests 2','# tests 0'),good.replace('# skipped 0','# skipped 1'),good.replace('# fail 0','# fail 1'),''):
            with self.assertRaises(C.Refused): f(bad,2)
    def test_original_forms_default_reporter_summary(self):
        text="\n".join("ℹ "+x for x in ["tests 2","suites 0","pass 2","fail 0","cancelled 0","skipped 0","todo 0"])
        self.assertEqual(self.api("tap_counts")(text,2)["tests"],2)
    def event(self):
        return {'repository':{'full_name':'2NTTY/child-ai-caregiver'},'action':'opened','pull_request':{'head':{'sha':'a'*40,'ref':'codex/preview-hf-offline-ci-20261106','repo':{'full_name':'2NTTY/child-ai-caregiver'}},'base':{'repo':{'full_name':'2NTTY/child-ai-caregiver'}}}}
    def test_exact_pr_head_admission(self):self.api('admit_event')(self.event(),'a'*40,'a'*40,'pull_request')
    def test_admission_bad_sha_repo_branch_event(self):
        f=self.api('admit_event')
        for field,value in [('sha','b'*40),('ref','master'),('repo',{'full_name':'other/repo'})]:
            e=self.event();e['pull_request']['head'][field]=value
            with self.assertRaises(C.Refused):f(e,'a'*40,'a'*40,'pull_request')
        for sha,event in [('', 'pull_request'),('a'*40,'workflow_dispatch'),('a'*40,'push')]:
            with self.assertRaises(C.Refused):f(self.event(),sha,'a'*40,event)
    def test_runner_env_requires_evidence_and_no_unknown_keys(self):
        f=self.api('validate_stage_env');env={'PATH':'/toolchain/bin:/usr/bin:/bin:/usr/sbin:/sbin','HOME':'/work/home','TMPDIR':'/work/tmp','CI':'true','TZ':'UTC','LC_ALL':'C.UTF-8','NODE_OPTIONS':'--max-old-space-size=256','EXPO_OFFLINE':'1','EXPO_NO_TELEMETRY':'1','EXPO_NO_DOTENV':'1','npm_config_update_notifier':'false','npm_config_audit':'false','npm_config_fund':'false','npm_config_userconfig':'/dev/null','npm_config_globalconfig':'/etc/empty-global.npmrc','PROJECT_UNDER_TEST':'/project','RUNTIME_UNDER_TEST':'/project/frontend/src/preview/synthetic-preview-runtime.mjs','BOOTSTRAP_UNDER_TEST':'/project/frontend/src/preview/workbench-normal-read/src/synthetic-preview-read-bootstrap.mjs','RED_BASE':'0','INTEGRATION_EVIDENCE':'/work/evidence-stage-1'}
        f(env,portable=True)
        for key in ('INTEGRATION_EVIDENCE','PROJECT_UNDER_TEST','EXPO_NO_DOTENV'):
            bad=env.copy();del bad[key]
            with self.assertRaises(C.Refused):f(bad,portable=True)
        bad=env.copy();bad['GITHUB_TOKEN']='synthetic'
        with self.assertRaises(C.Refused):f(bad,portable=True)
    def test_npm_user_and_global_configs_are_distinct(self):
        self.api("validate_stage_env")
        self.assertNotEqual(C.BASE_ENV["npm_config_userconfig"],C.BASE_ENV["npm_config_globalconfig"])
    def test_product_commands_are_full_original_scopes(self):
        f=self.api('command_plan');p=f('harbour');self.assertEqual([x['id']for x in p[:3]],['typecheck','forms','export']);self.assertIn('--listFiles',p[0]['argv']);self.assertIn('--extendedDiagnostics',p[0]['argv']);self.assertEqual(p[1]['argv'][-4:],['run','test:forms','--workspace','frontend']);self.assertEqual(p[2]['argv'][-3:],['--','--max-workers','1']);self.assertEqual(len(p[3:]),4)
        with self.assertRaises(C.Refused):f('unknown')
    def test_runtime_original_totals_not_integration(self):
        f=self.api('command_plan')
        for v,n,total in [('fourth',6,33),('harbour',4,76)]:
            p=f(v)[3:];self.assertEqual(len(p),n);self.assertEqual(sum(x['cases'] for x in p),total);self.assertFalse(any('integration.test' in ' '.join(x['argv'])for x in p))
    def test_lock_registry_integrity_link_validation(self):
        f=self.api('validate_lock'); import base64
        pkg={'name':'root','workspaces':['frontend'],'dependencies':{}};front={'name':'frontend-package','dependencies':{}}
        d={'lockfileVersion':3,'packages':{'':pkg,'frontend':front,'node_modules/frontend-package':{'link':True,'resolved':'frontend'},'node_modules/a':{'version':'1','resolved':'https://registry.npmjs.org/a/-/a-1.tgz','integrity':'sha512-'+base64.b64encode(b'0'*64).decode()}}}
        f(d,pkg,front)
        for field,value in [('resolved','https://evil.invalid/a.tgz'),('resolved','https://registry.npmjs.org@evil.invalid/a.tgz'),('integrity','sha512-bad')]:
            bad=copy.deepcopy(d);bad['packages']['node_modules/a'][field]=value
            with self.assertRaises(C.Refused):f(bad,pkg,front)
        bad=copy.deepcopy(d);bad['packages']['node_modules/frontend-package']['resolved']='../outside'
        with self.assertRaises(C.Refused):f(bad,pkg,front)
if __name__=='__main__':unittest.main(verbosity=2)
