import pathlib,sys,tempfile,unittest,json,importlib.util
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
spec=importlib.util.spec_from_file_location('terminal_receipt',ROOT/'terminal_receipt.py')if(ROOT/'terminal_receipt.py').exists()else None
T=importlib.util.module_from_spec(spec)if spec else None
if spec:spec.loader.exec_module(T)
class Terminal(unittest.TestCase):
    def api(self,name):self.assertTrue(T is not None and callable(getattr(T,name,None)),'missing safe terminal API '+name);return getattr(T,name)
    def test_no_raw_exception_env_title_or_escape_can_escape(self):
        f=self.api('safe_process');r=f({'exitCode':7,'wallSeconds':0.5,'timedOut':False,'groupEmpty':True,'allOwnedReaped':True,'lingeringChildrenAfterLeader':False,'sampledAggregatePeakRssKiB':42,'wait4LeaderMaxRssKiB':43,'signals':['SIGTERM','SECRET\x1b]'],'environment':{'GITHUB_TOKEN':'SECRET'},'stdout':'SECRET','argv':['SECRET']})
        text=json.dumps(r);self.assertNotIn('SECRET',text);self.assertNotIn('environment',text);self.assertEqual(r['exitCode'],7);self.assertEqual(r['signals'],['SIGTERM'])
    def test_missing_or_nonfinite_process_is_not_complete(self):
        f=self.api('safe_process')
        for x in ({},{'exitCode':False},{'wallSeconds':float('nan')}):self.assertFalse(f(x)['complete'])
    def test_known_ts_coordinates_only(self):
        f=self.api('diagnostics');roots={'frontend/src/a.ts'}
        r=f('src/a.ts(2,3): error TS2322: SECRET\n/secret/home/a.ts(1,1): error TS9999: SECRET\n\x1b[31mPRIVATE',roots,'typecheck');text=json.dumps(r);self.assertNotIn('SECRET',text);self.assertNotIn('secret/home',text);self.assertNotIn('PRIVATE',text);self.assertEqual(r['typescript'][0],{'path':'frontend/src/a.ts','line':2,'column':3,'code':2322})
    def test_test_failure_only_ordinal_and_suite(self):
        f=self.api('diagnostics');r=f('not ok 4 - secret title\n  error: secret value\n',set(),'forms');self.assertEqual(r['testFailures'],[{'suite':'forms','ordinal':4}]);self.assertNotIn('secret',json.dumps(r))
    def test_program_preserves_full_known_relative_members(self):
        f=self.api('safe_program')
        with tempfile.TemporaryDirectory()as d:
            p=pathlib.Path(d);source='frontend/src/a.ts';dependency='node_modules/typescript/lib/lib.d.ts'
            for name in (source,dependency):(p/name).parent.mkdir(parents=True,exist_ok=True);(p/name).write_bytes(b'x')
            sources={source:{'path':source,'bytes':1,'sha256':T.sha(b'x')}}
            r=f({'files':['/project/'+source,'/project/'+dependency],'count':2,'directRoots':1},sources,{'node_modules/typescript'},project=p)
            self.assertTrue(r['complete']);self.assertEqual(r['members'],['frontend/src/a.ts','node_modules/typescript/lib/lib.d.ts']);self.assertNotIn('/project/',json.dumps(r))
    def test_program_unknown_escape_duplicate_or_cap_never_complete(self):
        f=self.api('safe_program')
        for names in (['/secret/file'],['/project/frontend/../secret'],['/project/frontend/src/a.ts']*2,['/project/frontend/src/a.ts\x1b']):
            r=f({'files':names,'count':len(names),'directRoots':1},{'frontend/src/a.ts'},set());self.assertFalse(r['complete']);self.assertNotIn('secret/file',json.dumps(r))
    def test_program_count_booleans_are_not_numeric_evidence(self):
        f=self.api('safe_program');self.assertFalse(f({'files':['/project/frontend/src/a.ts'],'count':True,'directRoots':True},{'frontend/src/a.ts'},set())['complete'])
    def test_json_reader_refuses_symlink_and_oversized(self):
        f=self.api('read_object')
        with tempfile.TemporaryDirectory()as d:
            p=pathlib.Path(d);(p/'a').write_text('{}');(p/'b').symlink_to('a');self.assertIsNone(f(p,'b'));(p/'large').write_text('x'*100);self.assertIsNone(f(p,'large',16))
    def test_truncated_terminal_forces_nonzero_step(self):
        f=self.api("terminal_exit_code");text=T.bounded_emit({"status":"PASS","evidenceComplete":True,"compiler":{"members":["x"*100]*1000}},4096)
        self.assertEqual(f(text),1)
    def test_emit_cap_marks_incomplete_without_raw_fallback(self):
        f=self.api('bounded_emit');r={'schema':'preview-hf-safe-terminal-v1','status':'PASS','evidenceComplete':True,'compiler':{'members':['x'*100]*1000},'stages':[]}
        text=f(r,4096);x=json.loads(text);self.assertNotEqual(x['status'],'PASS');self.assertFalse(x['evidenceComplete']);self.assertLessEqual(len(text),4096)
if __name__=='__main__':unittest.main(verbosity=2)
