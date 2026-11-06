"""R01–R03 models use ordinary temporary files, not product/OS isolation runs."""
import json,os,pathlib,stat,subprocess,sys,tempfile,unittest
import test_terminal_integration as fixture
T=fixture.T
ROOT=pathlib.Path(__file__).resolve().parents[1]
class ReReview(unittest.TestCase):
    def setUp(self):
        self.f=fixture.TerminalIntegration();self.f.setUp();self.addCleanup(self.f.doCleanups)
    def mutate(self,rel,key,value):
        p=self.f.work/rel;x=json.loads(p.read_text());x[key]=value;self.f.put(p,x)
    def reject(self):
        r=self.f.collect();self.assertNotEqual(r['status'],'PASS');self.assertEqual(T.terminal_exit_code(T.bounded_emit(r)),1);return r
    def test_R01_root_phase_file_is_readable_by_other_uid_model(self):
        script=(ROOT/'sandbox-root.sh').read_text();phase=script.split('phase() {',1)[1].split('\nphase namespace-entry',1)[0]
        with tempfile.TemporaryDirectory()as d:
            p=pathlib.Path(d);(p/'work').mkdir(mode=0o700)
            proc=subprocess.run(['bash','-c','set -Eeuo pipefail; umask 077; AREA="$1"; phase() {'+phase+'\nphase device-mounts','phase-model',d],capture_output=True,text=True,timeout=5)
            self.assertEqual(proc.returncode,0);f=p/'work/bootstrap-progress.json';mode=stat.S_IMODE(f.stat().st_mode)
            self.assertEqual(mode,0o644);self.assertTrue(mode&stat.S_IROTH);self.assertEqual(stat.S_IMODE((p/'work').stat().st_mode),0o700);self.assertEqual(json.loads(f.read_text()),{'phase':'device-mounts'})
            # Root creator/nonroot reader modeled by other-read bit; no UID switch.
    def test_R02_required_zero_values_are_strict_int(self):
        for value in (False,None,'0',0.0):
            with self.subTest(field='sandboxExitCode',value=value):
                self.mutate('sandbox-terminal.json','sandboxExitCode',value);self.reject()
        self.mutate('sandbox-terminal.json','sandboxExitCode',0)
        p=self.f.work/'isolated-inputs.json';original=p.read_bytes()
        for value in (False,None,'0',0.0):
            with self.subTest(field='externalRoutes',value=value):
                x=json.loads(original);x['isolation']['externalRoutes']=value;self.f.put(p,x);self.reject()
        p.write_bytes(original)
        for value in (False,None,'0',0.0):
            with self.subTest(field='result.exitCode',value=value):
                self.mutate('stage-forms/result.json','exitCode',value);self.reject()
        self.mutate('stage-forms/result.json','exitCode',0)
        for value in (False,None,'0',0.0):
            with self.subTest(field='process.exitCode',value=value):
                self.mutate('stage-forms/terminal.json','exitCode',value);self.reject()
        self.mutate('stage-forms/terminal.json','exitCode',0);self.assertEqual(self.f.collect()['status'],'PASS')
    def test_R03_nonexistent_dependency_never_printed(self):
        token='SYNTHETIC_SECRET_TOKEN_ABCDEFGHIJKLMNOPQRSTUVWXYZ';p=self.f.work/'stage-typecheck/full-program.json';x=json.loads(p.read_text());x['files'].append('/project/node_modules/typescript/'+token+'.ts');x['count']+=1;self.f.put(p,x)
        r=self.reject();self.assertNotIn(token,T.bounded_emit(r));self.assertFalse(r['compiler']['complete'])
    def test_R03_nonexistent_tool_never_printed(self):
        token='SYNTHETIC_SECRET_TOKEN_ABCDEFGHIJKLMNOPQRSTUVWXYZ';p=self.f.work/'tool-resolution.json';x=json.loads(p.read_text());x['typescript']['entry']='/project/node_modules/typescript/'+token+'.js';self.f.put(p,x)
        self.assertNotIn(token,T.bounded_emit(self.reject()))
    def test_R03_wrong_tool_package_rejected(self):
        p=self.f.work/'tool-resolution.json';x=json.loads(p.read_text());x['typescript']['entry']='/project/node_modules/expo/index.js';self.f.put(p,x);r=self.reject();self.assertIsNone(r['tools']['typescript']['entry'])
    def test_R03_missing_or_drifted_source_rejected(self):
        p=self.f.area/'project/frontend/src/a.ts';p.write_bytes(b'drift');r=self.reject();self.assertNotIn('frontend/src/a.ts',r['compiler']['members']);p.unlink();self.reject()
    def test_R03_installed_lock_mismatch_rejected_before_paths(self):
        p=self.f.area/'project/node_modules/.package-lock.json';p.write_text('{}');r=self.reject();self.assertFalse(any('node_modules/'in n for n in r['compiler']['members']));self.assertIsNone(r['tools']['typescript']['entry'])
    def test_R03_metadata_drift_rejected(self):
        p=self.f.area/'project/node_modules/typescript/package.json';x=json.loads(p.read_text());x['version']='0.0.0';self.f.put(p,x);r=self.reject();self.assertIsNone(r['tools']['typescript']['packageJson'])
    def test_R03_entry_internal_link_allowed_escape_rejected(self):
        root=self.f.area/'project';p=root/'node_modules/typescript/index.js';p.unlink();p.symlink_to('actual.js');(p.parent/'actual.js').write_bytes(b'// synthetic\n');self.assertEqual(self.f.collect()['status'],'PASS')
        p.unlink();outside=self.f.base/'outside.js';outside.write_bytes(b'// synthetic\n');p.symlink_to(outside);r=self.reject();self.assertIsNone(r['tools']['typescript']['entry'])
    def test_R03_dependency_ancestor_link_contained_or_rejected(self):
        root=self.f.area/'project';pkg=root/'node_modules/typescript';(pkg/'real').mkdir();(pkg/'real/member.d.ts').write_bytes(b'// synthetic\n');(pkg/'alias').symlink_to('real',target_is_directory=True)
        p=self.f.work/'stage-typecheck/full-program.json';x=json.loads(p.read_text());x['files'][1]='/project/node_modules/typescript/alias/member.d.ts';self.f.put(p,x);self.assertEqual(self.f.collect()['status'],'PASS')
        (pkg/'alias').unlink();(pkg/'alias').symlink_to(self.f.base,target_is_directory=True);(self.f.base/'member.d.ts').write_bytes(b'// synthetic\n');r=self.reject();self.assertNotIn('node_modules/typescript/alias/member.d.ts',r['compiler']['members'])
    def test_R03_package_prefix_and_unlisted_nested_package_rejected(self):
        for rel in ('node_modules/typescript-other/member.d.ts','node_modules/typescript/node_modules/unknown/member.d.ts'):
            self.f.put_bytes(self.f.area/'project'/rel,b'// synthetic\n');p=self.f.work/'stage-typecheck/full-program.json';x=json.loads(p.read_text());x['files'][1]='/project/'+rel;self.f.put(p,x);r=self.reject();self.assertNotIn(rel,r['compiler']['members'])
    def test_R03_regular_member_required(self):
        p=self.f.area/'project/node_modules/typescript/lib.d.ts';p.unlink();p.mkdir();self.reject()
    def test_R03_dependency_root_symlink_rejected(self):
        root=self.f.area/'project';(root/'node_modules').rename(root/'moved');(root/'node_modules').symlink_to('moved',target_is_directory=True);r=self.reject();self.assertFalse(any('node_modules/'in n for n in r['compiler']['members']))
    def test_R03_outside_symlink_roundtrip_rejected(self):
        root=self.f.area/'project';pkg=root/'node_modules/typescript';outside=self.f.base/'outside';outside.mkdir();(outside/'back').symlink_to(pkg,target_is_directory=True)
        p=pkg/'lib.d.ts';p.unlink();p.symlink_to(outside/'back/actual.d.ts');(pkg/'actual.d.ts').write_bytes(b'// synthetic')
        r=self.reject();self.assertNotIn('node_modules/typescript/lib.d.ts',r['compiler']['members'])
    def test_R03_source_symlink_rejected(self):
        p=self.f.area/'project/frontend/src/a.ts';p.rename(p.parent/'real.ts');p.symlink_to('real.ts');r=self.reject();self.assertNotIn('frontend/src/a.ts',r['compiler']['members'])
    def test_R03_tool_metadata_hash_and_name_must_match(self):
        p=self.f.area/'project/node_modules/typescript/package.json';original=p.read_bytes()
        for name in ('typescript','different-package'):
            x=json.loads(original);x['name']=name;x['description']='synthetic drift';self.f.put(p,x);r=self.reject();self.assertIsNone(r['tools']['typescript']['packageJson'])
    def test_R03_tool_package_json_exact_expected_package(self):
        p=self.f.work/'tool-resolution.json';x=json.loads(p.read_text());x['typescript']['packageJson']='/project/node_modules/expo/package.json';self.f.put(p,x);r=self.reject();self.assertIsNone(r['tools']['typescript']['packageJson']);self.assertIsNone(r['tools']['typescript']['entry'])
    def test_R03_isolated_install_identity_must_match_setup(self):
        p=self.f.work/'isolated-inputs.json';x=json.loads(p.read_text());x['dependency']['installedLockSha256']='0'*64;self.f.put(p,x);r=self.reject();self.assertFalse(any('node_modules/'in n for n in r['compiler']['members']))
    def test_R03_symlink_dotdot_uses_filesystem_not_lexical_resolution(self):
        pkg=self.f.area/'project/node_modules/typescript';outside=self.f.base/'outside';(outside/'child').mkdir(parents=True);(outside/'actual.d.ts').write_bytes(b'// outside synthetic');(pkg/'actual.d.ts').write_bytes(b'// inside synthetic')
        (pkg/'hop').symlink_to(outside/'child',target_is_directory=True);p=pkg/'lib.d.ts';p.unlink();p.symlink_to('hop/../actual.d.ts')
        r=self.reject();self.assertNotIn('node_modules/typescript/lib.d.ts',r['compiler']['members'])
if __name__=='__main__':unittest.main(verbosity=2)
