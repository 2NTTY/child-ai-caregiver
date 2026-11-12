import assert from 'node:assert/strict';
import {test as nodeTest} from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const revision='a'.repeat(40), imageId='sha256:'+ 'b'.repeat(64), digest='sha256:'+'c'.repeat(64);
const root=resolve(import.meta.dirname,'../..');
const test=(name,run)=>nodeTest(name,{skip:process.platform!=='linux'&&'These scripts target GitHub Linux runners; run in the Linux verification image.'},run);
async function fixture(t) {
  const directory=await mkdtemp(join(tmpdir(),'release-images-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const bin=join(directory,'bin');await mkdir(bin);
  await mkdir(join(directory,'site-preflight'));await writeFile(join(directory,'site-preflight/status.json'),'{}');
  const log=join(directory,'docker.jsonl');
  const docker=`#!/usr/bin/env node
import {appendFileSync} from 'node:fs';
const args=process.argv.slice(2);appendFileSync(process.env.MOCK_LOG,JSON.stringify({args,credential:!!process.env.SITE_ACCESS_TOKEN})+'\\n');
if(args[0]==='save') process.stdout.write('synthetic saved image');
if(args[0]==='image'&&args[1]==='inspect') {
 const format=args[args.indexOf('--format')+1];
 if(format==='{{.Id}}') console.log(process.env.WRONG_IMAGE_ID?'sha256:'+'d'.repeat(64):'${imageId}');
 else if(format.includes('RepoDigests')) console.log(JSON.stringify(['asia-east2-docker.pkg.dev/ai-caregivers-for-children/site-release/'+(args[2].includes('/web:')?'web':'backend')+'@${digest}']));
 else console.log(process.env.WRONG_REVISION?'invalid':process.env.GITHUB_SHA);
}
if(args[0]==='run'&&process.env.FAIL_CANDIDATE)process.exitCode=1;
`;
  await writeFile(join(bin,'docker'),docker);await chmod(join(bin,'docker'),0o755);
  await writeFile(join(bin,'git'),'#!/usr/bin/env node\nif(process.argv[2]==="rev-parse")console.log(process.env.MOCK_CHECKOUT_SHA||process.env.GITHUB_SHA);\n');
  await chmod(join(bin,'git'),0o755);
  await writeFile(join(bin,'npm'),`#!/usr/bin/env node
import {appendFileSync} from 'node:fs';
appendFileSync(process.env.MOCK_LOG,JSON.stringify({args:['npm',...process.argv.slice(2)],credential:!!process.env.SITE_ACCESS_TOKEN})+'\\n');
if(process.argv[2]==='--version')console.log('11.8.0');
`);await chmod(join(bin,'npm'),0o755);
  await writeFile(join(bin,'node'),`#!/usr/bin/env bash
if [[ $1 = scripts/site-release/build-checks.mjs ]]; then
  exec '${process.execPath}' --input-type=module -e 'import {appendFileSync,writeFileSync} from "node:fs";appendFileSync(process.env.MOCK_LOG,JSON.stringify({args:["offline-checks"],credential:!!process.env.SITE_ACCESS_TOKEN})+"\\n");if(process.env.FAIL_CHECKS)process.exit(1);writeFileSync(process.argv[1],JSON.stringify({passed:true}));' "$4"
fi
exec '${process.execPath}' "$@"
`);await chmod(join(bin,'node'),0o755);
  const env={...process.env,PATH:bin+':'+process.env.PATH,RUNNER_TEMP:directory,GITHUB_SHA:revision,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'2',WEB:'true',BACKEND:'true',MOCK_LOG:log,
    EXPO_PUBLIC_AUTH_PROVIDER:'firebase',EXPO_PUBLIC_AUTH_PROVIDERS:'',EXPO_PUBLIC_ACCOUNT_LEGACY_TRIAL:'false',EXPO_PUBLIC_FIREBASE_API_KEY:'synthetic-public-key',EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN:'synthetic.example.test',EXPO_PUBLIC_FIREBASE_PROJECT_ID:'synthetic-project',EXPO_PUBLIC_FIREBASE_APP_ID:'synthetic-app'};
  for(const key of ['SITE_ACCESS_TOKEN','GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_ACCESS_TOKEN','GOOGLE_GHA_CREDS_PATH','GOOGLE_APPLICATION_CREDENTIALS_JSON'])delete env[key];
  const run=(script,patch={})=>spawnSync('bash',[join(root,'scripts/site-release',script)],{cwd:root,env:{...env,...patch},encoding:'utf8',timeout:30000});
  const calls=async()=> (await readFile(log,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  return {directory,env,run,calls};
}
function passed(result){assert.equal(result.status,0,result.stderr+result.stdout);}

test('build packages selected candidates and publisher verifies them before authenticated push',async t=>{
  const f=await fixture(t);passed(f.run('build.sh'));
  const manifest=JSON.parse(await readFile(join(f.directory,'site-images/manifest.json'),'utf8'));
  assert.equal(manifest.revision,revision);assert.deepEqual(Object.keys(manifest.services).sort(),['backend','web']);
  passed(f.run('publish-images.sh',{SITE_ACCESS_TOKEN:'synthetic-token'}));
  assert.deepEqual(JSON.parse(await readFile(join(f.directory,'digests.json'),'utf8')),{web:digest,backend:digest});
  const calls=await f.calls(),login=calls.findIndex(c=>c.args[0]==='login');
  assert.ok(login>0);assert.ok(calls.slice(0,login).some(c=>c.args[0]==='load'));
  assert.ok(calls.findIndex(c=>c.args[0]==='offline-checks')<calls.findIndex(c=>c.args[0]==='build'));
  assert.ok(calls.filter(c=>c.args[0]==='run').every(c=>!c.credential));
  assert.ok(calls.slice(login).every(c=>!['run','build'].includes(c.args[0])));
  assert.deepEqual(calls.filter(c=>c.args[0]==='push').map(c=>c.args[1]).sort(),['backend','web'].map(s=>'asia-east2-docker.pkg.dev/ai-caregivers-for-children/site-release/'+s+':'+revision+'-123-2').sort());
});

test('builder refuses cloud credentials before running Docker',async t=>{
  const f=await fixture(t);const result=f.run('build.sh',{SITE_ACCESS_TOKEN:'synthetic-token'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/credential/i);
  await assert.rejects(readFile(f.env.MOCK_LOG),{code:'ENOENT'});
});

test('failed candidate produces no complete artifact manifest',async t=>{
  const f=await fixture(t);const result=f.run('build.sh',{FAIL_CANDIDATE:'1'});
  assert.notEqual(result.status,0);await assert.rejects(readFile(join(f.directory,'site-images/manifest.json')),{code:'ENOENT'});
});

test('publisher rejects tampered archives before login',async t=>{
  const f=await fixture(t);passed(f.run('build.sh'));
  await writeFile(join(f.directory,'site-images/web.tar.gz'),'tampered');
  assert.notEqual(f.run('publish-images.sh',{SITE_ACCESS_TOKEN:'synthetic-token'}).status,0);
  assert.ok(!(await f.calls()).some(c=>c.args[0]==='login'));
});

test('publisher rejects mismatched image labels and selected service sets before login',async t=>{
  const f=await fixture(t);passed(f.run('build.sh'));
  for(const patch of [{WRONG_REVISION:'1'},{WRONG_IMAGE_ID:'1'},{BACKEND:'false'}]){
    assert.notEqual(f.run('publish-images.sh',{SITE_ACCESS_TOKEN:'synthetic-token',...patch}).status,0);
  }
  assert.ok(!(await f.calls()).some(c=>c.args[0]==='login'));
});

test('independent service selections package and publish only the selected image',async t=>{
  for(const service of ['web','backend']){
    const f=await fixture(t), selection={WEB:String(service==='web'),BACKEND:String(service==='backend')};
    passed(f.run('build.sh',selection));
    const manifest=JSON.parse(await readFile(join(f.directory,'site-images/manifest.json'),'utf8'));
    assert.deepEqual(Object.keys(manifest.services),[service]);
    passed(f.run('publish-images.sh',{...selection,SITE_ACCESS_TOKEN:'synthetic-token'}));
    assert.deepEqual(JSON.parse(await readFile(join(f.directory,'digests.json'),'utf8')),{[service]:digest});
  }
});

test('publisher rejects a different workflow attempt before loading or login',async t=>{
  const f=await fixture(t);passed(f.run('build.sh'));
  const before=(await f.calls()).length;
  assert.notEqual(f.run('publish-images.sh',{GITHUB_RUN_ATTEMPT:'3',SITE_ACCESS_TOKEN:'synthetic-token'}).status,0);
  assert.equal((await f.calls()).length,before);
});

test('builder rejects a checkout that differs from the declared immutable revision',async t=>{
  const f=await fixture(t), result=f.run('build.sh',{MOCK_CHECKOUT_SHA:'d'.repeat(40)});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Checkout HEAD/);
  await assert.rejects(readFile(f.env.MOCK_LOG),{code:'ENOENT'});
});

test('failed offline checks stop the build before Docker and artifact publication',async t=>{
  const f=await fixture(t),result=f.run('build.sh',{FAIL_CHECKS:'1'});
  assert.notEqual(result.status,0);
  assert.ok(!(await f.calls()).some(c=>c.args[0]==='build'));
  await assert.rejects(readFile(join(f.directory,'site-images/manifest.json')),{code:'ENOENT'});
});
