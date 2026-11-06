"""Temporary synthetic receipt fixtures. No product source or Node command runs."""
import pathlib,sys,tempfile,unittest,json,copy
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
import terminal_receipt as T
from controls import row,sha,canonical,command_plan,BASES,BRANCH,REPOSITORY
class TerminalIntegration(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=pathlib.Path(self.tmp.name);self.here=self.base/'controls';self.area=self.base/'area';self.work=self.area/'work';self.here.mkdir();self.work.mkdir(parents=True);self.variant='harbour';self.head='a'*40;self.pin='b'*64
        self.outcomes={k:'success'for k in ('checkout','base','node','setup','offline')}
        self.versions={'typescript':'6.0.3','expo':'57.0.24','react':'19.2.3','react-native':'0.86.3','@expo/metro-config':'57.0.12','@expo/cli':'57.0.26'}
        self.package_paths={name:'node_modules/'+('expo/node_modules/'+name if name=='@expo/cli'else name)for name in self.versions}
        lock=json.dumps({'packages':{self.package_paths[name]:{'version':v}for name,v in self.versions.items()}}).encode();self.put_bytes(self.area/'project/package-lock.json',lock)
        self.source=[row('frontend/src/a.ts',b'x')];self.supp=[row('package-lock.json',lock)];entries=self.source+self.supp
        self.expected={'files':2,'bytes':sum(x['bytes']for x in entries),'membersSha256':sha(canonical(sorted(entries,key=lambda x:x['path'])))}
        v={'publicBaseCommit':BASES[self.variant],'sourceProjection':self.source,'supplementalInputs':self.supp,'sourceFileCount':1,'sourceBytes':1,'directRoots':['frontend/src/a.ts']}
        self.put(self.here/'inputs.json',{'variants':{self.variant:v}})
        self.put_bytes(self.area/'project/frontend/src/a.ts',b'x')
        self.put_bytes(self.area/'project/node_modules/typescript/lib.d.ts',b'// synthetic declaration\n')
        metadata={}
        for name,version in self.versions.items():
            rel=self.package_paths[name];b=json.dumps({'name':name,'version':version,'main':'index.js'}).encode();self.put_bytes(self.area/'project'/rel/'package.json',b);self.put_bytes(self.area/'project'/rel/'index.js',b'// synthetic entry\n')
            metadata[rel.removeprefix('node_modules/')]={'path':'/project/'+rel+'/package.json','version':version,'packageJsonSha256':sha(b)}
        hidden=json.dumps({'lockfileVersion':3,'packages':json.loads(lock)['packages']}).encode();self.put_bytes(self.area/'project/node_modules/.package-lock.json',hidden)
        self.dependency={'installedLockSha256':sha(hidden),'installedEntries':6,'resolvedToolMetadata':metadata,'dependencyLinks':[]}
        self.put(self.work/'admission.json',{'repository':REPOSITORY,'branch':BRANCH,'sha':self.head})
        self.put(self.work/'assembly.json',{'assembly':self.expected,'baseCommit':BASES[self.variant]})
        self.put(self.work/'setup-progress.json',{'phase':'setup-finalization','completed':T.SETUP})
        self.put(self.work/'setup.json',{'nodeVersion':'v24.22.1','npmVersion':'11.8.0','nodeBinarySha256':'c'*64,'npmPackageJsonSha256':'d'*64,'source':self.expected,'installedMetadata':self.dependency})
        self.put(self.work/'host-resources.json',{'meminfo':'MemAvailable: 100 kB\n','diskAvailableBytes':999,'memory.current':'12\n','memory.peak':'15\n'})
        self.put(self.work/'isolated-inputs.json',{'sha':self.head,'variant':self.variant,'assembly':self.expected,'inputManifestSha256':sha((self.here/'inputs.json').read_bytes()),'lockSha256':sha(lock),'dependency':self.dependency,'isolation':{'capabilitiesZero':True,'noNewPrivileges':True,'inputMountsReadOnly':True,'externalRoutes':0,'interfaces':['lo DOWN']}})
        self.put(self.work/'sandbox-terminal.json',{'sandboxExitCode':0});self.put(self.work/'bootstrap-progress.json',{'phase':'privilege-drop'})
        for stage in T.SETUP[1:]:self.put(self.area/'setup'/stage/'terminal.json',self.process())
        for stage in T.TOOLS:
            prefix='version-'+stage if stage in ('node','npm')else stage;self.put(self.work/prefix/'terminal.json',self.process())
        self.put(self.work/'tool-resolution.json',{name:{'version':v,'packageJson':'/project/'+self.package_paths[name]+'/package.json','entry':'/project/'+self.package_paths[name]+'/index.js'}for name,v in self.versions.items()})
        plan=command_plan(self.variant);summary=[]
        for stage in plan:
            d=self.work/('stage-'+stage['id']);self.put(d/'terminal.json',self.process());self.put_bytes(d/'output.raw',b'')
            result={'id':stage['id'],'exitCode':0}
            if 'cases'in stage or stage['id']=='forms':result['counts']=self.counts(stage.get('cases',2))
            if 'cases'in stage:
                evidence=d/'evidence';evidence.mkdir();result['semanticEvidence']=[]
                for name in {'collector':['actual-retirement.json','concurrent-completion.json'],'session':['wire-success.json']}.get(stage['id'],[]):
                    b=b'{"synthetic":true}';self.put_bytes(evidence/name,b);result['semanticEvidence'].append(row(name,b))
            self.put(d/'result.json',result);summary.append(result)
        self.put(self.work/'stage-typecheck/full-program.json',{'files':['/project/frontend/src/a.ts','/project/node_modules/typescript/lib.d.ts'],'count':2,'directRoots':1})
        bundle=[row('index.html',b'x')];self.put(self.work/'stage-export/bundle-census.json',{'files':bundle,'membersSha256':sha(canonical(bundle))})
        self.put(self.work/'final-source.json',self.expected);self.put(self.work/'runner-progress.json',{'phase':plan[-1]['id'],'completed':['isolation']+T.TOOLS+[s['id']for s in plan]})
        self.put(self.work/'sanitized-summary.json',{'sha':self.head,'variant':self.variant,'stages':summary})
    def put_bytes(self,p,b):p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
    def put(self,p,x):self.put_bytes(p,json.dumps(x).encode())
    def process(self):return {'exitCode':0,'wallSeconds':0.1,'timedOut':False,'groupEmpty':True,'allOwnedReaped':True,'lingeringChildrenAfterLeader':False,'signals':[],'processGroup':10,'observedPids':[10],'reapedPids':[10],'sampledAggregatePeakRssKiB':20,'wait4LeaderMaxRssKiB':30}
    def counts(self,n):return dict(tests=n,suites=0,**{'pass':n,'fail':0,'cancelled':0,'skipped':0,'todo':0})
    def collect(self):return T.collect(self.area,self.here,self.variant,self.head,self.head,self.pin,self.outcomes)
    def test_synthetic_complete_receipt_preserves_required_evidence(self):
        r=self.collect();self.assertEqual(r['status'],'PASS',r['reason']);self.assertTrue(r['evidenceComplete']);self.assertEqual(len(r['semanticEvidence']),3);self.assertEqual(r['compiler']['count'],2);self.assertEqual(r['hostResources']['memAvailableBytes'],102400);self.assertNotIn(str(self.base),T.bounded_emit(r))
    def test_missing_any_required_product_receipt_never_pass(self):
        for rel in ('stage-typecheck/full-program.json','stage-forms/result.json','stage-export/bundle-census.json','stage-collector/evidence/actual-retirement.json','final-source.json','tool-resolution.json','sanitized-summary.json'):
            p=self.work/rel;b=p.read_bytes();p.unlink()
            with self.subTest(rel=rel):self.assertNotEqual(self.collect()['status'],'PASS')
            p.write_bytes(b)
    def test_actual_failure_has_safe_stage_exit_and_ordinal(self):
        p=self.process();p['exitCode']=7;self.put(self.work/'stage-forms/terminal.json',p);(self.work/'stage-forms/result.json').unlink();self.put_bytes(self.work/'stage-forms/output.raw',b'not ok 4 - PRIVATE_SECRET_TITLE\n# tests 2\n# suites 0\n# pass 1\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0\nPRIVATE_SECRET_VALUE\x1b[31m')
        self.put(self.work/'runner-progress.json',{'phase':'forms','completed':['isolation']+T.TOOLS+['typecheck']});self.outcomes['offline']='failure';r=self.collect();self.assertEqual(r['status'],'FAIL');self.assertEqual(r['activeStage'],'forms');self.assertNotIn('PRIVATE_SECRET',T.bounded_emit(r));stage=next(x for x in r['stages']if x['id']=='forms');self.assertEqual(stage['process']['exitCode'],7);self.assertEqual(stage['counts']['fail'],1)
    def test_setup_failure_is_located_without_exception_text(self):
        self.outcomes['setup']='failure';self.outcomes['offline']='skipped';self.put(self.work/'setup-progress.json',{'phase':'npm-bootstrap','completed':['assembly','node-version']});(self.work/'runner-progress.json').unlink();p=self.process();p['exitCode']=9;self.put(self.area/'setup/npm-bootstrap/terminal.json',p);r=self.collect();self.assertEqual(r['reason'],'setup_failed');self.assertEqual(r['activeStage'],'npm-bootstrap');self.assertNotEqual(r['status'],'PASS')
    def test_bootstrap_failure_is_located_without_raw_error(self):
        self.outcomes['offline']='failure';(self.work/'isolated-inputs.json').unlink();(self.work/'runner-progress.json').unlink();self.put(self.work/'bootstrap-progress.json',{'phase':'device-mounts'});self.put(self.work/'sandbox-terminal.json',{'sandboxExitCode':32});self.put_bytes(self.work/'bootstrap.raw',b'/secret/path: PRIVATE_FAILURE');r=self.collect();self.assertEqual(r['reason'],'isolation_failed');self.assertEqual(r['bootstrapPhase'],'device-mounts');self.assertEqual(r.get('bootstrapExitCode'),32);self.assertNotIn('PRIVATE_FAILURE',T.bounded_emit(r))
    def test_mismatched_isolated_input_identity_never_pass(self):
        p=self.work/'isolated-inputs.json';x=json.loads(p.read_text());x['inputManifestSha256']='0'*64;self.put(p,x);self.assertNotEqual(self.collect()['status'],'PASS')
    def test_unstarted_job_does_not_claim_observed_assembly(self):
        outcomes={k:'skipped'for k in self.outcomes};outcomes['checkout']='failure'
        r=T.collect(self.base/'absent',self.here,self.variant,self.head,self.head,self.pin,outcomes)
        self.assertIs(r.get('assemblyObserved'),False);self.assertIs(r.get('finalSourceMatched'),False);self.assertNotEqual(r['status'],'PASS')
    def test_mismatched_head_cannot_be_pass(self):
        r=T.collect(self.area,self.here,self.variant,self.head,'c'*40,self.pin,self.outcomes);self.assertNotEqual(r['status'],'PASS');self.assertEqual(r['reason'],'identity_unavailable')
if __name__=='__main__':unittest.main(verbosity=2)
