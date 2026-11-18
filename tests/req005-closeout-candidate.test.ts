import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, join, dirname} from 'node:path';
import test from 'node:test';

const checker = resolve('scripts/ci/check-req005-closeout-candidate.sh');
test('closeout candidate binds head and integration to the event parents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'req005-candidate-'));
  const env = {...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid'};
  const git = (...args: string[]) => execFileSync('git', args, {cwd:dir, env, encoding:'utf8', stdio:['ignore','pipe','pipe']}).trim();
  try {
    git('init', '-b', 'master'); writeFileSync(join(dir,'base'), 'base'); git('add','.'); git('commit','-m','base');
    const base = git('rev-parse','HEAD');
    git('checkout','-b','candidate'); writeFileSync(join(dir,'candidate'),'candidate'); git('add','.'); git('commit','-m','candidate');
    const head = git('rev-parse','HEAD');
    const check = (mode:string, expected:string, expectedBase = base, expectedHead = head) => spawnSync('bash',[checker],{cwd:dir,env:{...env,CANDIDATE_MODE:mode,EXPECTED_SHA:expected,EXPECTED_BASE_SHA:expectedBase,EXPECTED_HEAD_SHA:expectedHead},encoding:'utf8'});
    let result = check('head',head); assert.equal(result.status,0,result.stderr);
    assert.notEqual(check('head',base).status,0,'wrong exact head must fail');
    assert.notEqual(check('merge',head).status,0,'single-parent head is not an integration candidate');
    git('checkout','master'); git('merge','--no-ff','candidate','-m','integration'); const merged = git('rev-parse','HEAD');
    result = check('merge',merged); assert.equal(result.status,0,result.stderr);
    assert.notEqual(check('merge',merged,head,base).status,0,'reversed/stale parents must fail');
    assert.notEqual(check('merge',merged,base,'a'.repeat(40)).status,0,'another PR head must fail');
    assert.notEqual(check('unknown',merged).status,0,'unknown mode must fail');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('closeout workflow checks both exact head and event merge candidate', () => {
  const workflow = readFileSync('.github/workflows/req005-closeout-offline.yml','utf8');
  assert.match(workflow,/candidate: \[head, merge\]/);
  assert.match(workflow,/github\.sha/);
  assert.match(workflow,/ref: \$\{\{ env\.EXPECTED_SHA \}\}/);
  assert.match(workflow,/fetch-depth: 2/);
  assert.match(workflow,/check-req005-closeout-candidate\.sh/);
});
test('closeout freshness rejects an old base or head even when the event is rerun', () => {
  const dir = mkdtempSync(join(tmpdir(), 'req005-freshness-'));
  const env = {...process.env, GIT_CONFIG_NOSYSTEM:'1', GIT_CONFIG_GLOBAL:'/dev/null',
    GIT_AUTHOR_NAME:'Test',GIT_AUTHOR_EMAIL:'test@example.invalid',GIT_COMMITTER_NAME:'Test',GIT_COMMITTER_EMAIL:'test@example.invalid'};
  const git = (...args:string[]) => execFileSync('git',args,{cwd:dir,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  try {
    git('init','-b','master'); git('commit','--allow-empty','-m','base'); const base=git('rev-parse','HEAD');
    git('checkout','-b','codex/req005-acceptance-closeout'); git('commit','--allow-empty','-m','head'); const head=git('rev-parse','HEAD');
    const check=()=>spawnSync('bash',[resolve('scripts/ci/check-req005-closeout-freshness.sh')],{cwd:dir,env:{...env,CANDIDATE_REMOTE:dir,EXPECTED_BASE_SHA:base,EXPECTED_HEAD_SHA:head},encoding:'utf8'});
    let result=check(); assert.equal(result.status,0,result.stderr);
    git('update-ref','refs/heads/master',head); assert.notEqual(check().status,0,'advanced master must reject old event');
    git('update-ref','refs/heads/master',base); git('commit','--allow-empty','-m','new head'); assert.notEqual(check().status,0,'advanced PR head must reject old event');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('closeout merge gate requires compaction integration coverage and checks freshness twice', () => {
  const workflow=readFileSync('.github/workflows/req005-closeout-offline.yml','utf8');
  assert.equal((workflow.match(/bash scripts\/ci\/check-req005-closeout-freshness.sh/g) ?? []).length,2);
  assert.match(workflow,/CANDIDATE_MODE="\$CANDIDATE_MODE"/);
  const gate=readFileSync('scripts/ci/verify-req005-closeout-offline.sh','utf8');
  assert.match(gate,/merge\)[\s\S]*TEST_FILES\+=\(tests\/agent-compaction-policy-barrier.test.ts\)/);
});
test('merge preflight requires all repaired integration regressions without weakening head checks', () => {
  const gate=readFileSync('scripts/ci/verify-req005-closeout-offline.sh','utf8');
  const preflight=gate.slice(gate.indexOf('GUARD='),gate.indexOf('stage=req005-closeout-tests'));
  const required=[
    'tests/agent-compaction-policy-barrier.test.ts',
    'tests/agent-compaction-durable-policy.test.ts',
    'tests/growth-history-cursor.test.ts',
    'tests/firestore-indexes-comparator.test.ts',
    'tests/agent-telemetry-liveness.test.ts',
    'tests/export-streaming.test.ts',
    'tests/handover-export.test.ts',
  ];
  for (const name of required) assert.ok(preflight.includes(name), `merge gate must select ${name}`);
  const dir=mkdtempSync(join(tmpdir(),'req005-gate-files-'));
  const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'Test',GIT_AUTHOR_EMAIL:'test@example.invalid',GIT_COMMITTER_NAME:'Test',GIT_COMMITTER_EMAIL:'test@example.invalid'};
  const git=(...args:string[])=>execFileSync('git',args,{cwd:dir,env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  try {
    git('init','-b','master');
    const paths=[...new Set([...preflight.matchAll(/(?:tests|frontend)\/[\w./-]+\.(?:ts|mjs|json)/g)].map(match=>match[0]).concat(['tsconfig.json','tsconfig.server.json','frontend/tsconfig.json','scripts/ci/req005-closeout-results.mjs']))];
    for (const name of paths) {mkdirSync(dirname(join(dir,name)),{recursive:true});writeFileSync(join(dir,name),'fixture');}
    git('add','.');git('commit','-m','fixtures');
    const check=(mode:string)=>spawnSync('bash',['-euo','pipefail','-c',preflight],{cwd:dir,env:{...env,CANDIDATE_MODE:mode},encoding:'utf8'});
    let result=check('merge'); assert.equal(result.status,0,result.stderr);
    for (const name of required) {
      rmSync(join(dir,name));git('add','-u');git('commit','-m','remove required fixture');
      assert.notEqual(check('merge').status,0,`missing ${name} must fail closed`);
      result=check('head');assert.equal(result.status,0,result.stderr);
      writeFileSync(join(dir,name),'fixture');git('add','.');git('commit','-m','restore fixture');
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('closeout runs actual cases and rejects skipped, pending or empty files even when Node exits zero', () => {
  const script=readFileSync('scripts/ci/verify-req005-closeout-offline.sh','utf8');
  const stage=script.slice(script.indexOf('stage=req005-closeout-tests'),script.indexOf('stage=full-types'));
  const dir=mkdtempSync(join(tmpdir(),'req005-closeout-counts-'));
  const env: NodeJS.ProcessEnv={...process.env,NODE_BIN:process.execPath,GUARD:'frontend/scripts/family-cleanup-network-guard.mjs'};
  delete env.NODE_TEST_CONTEXT;
  try {
    const fixtures: [string,string,boolean][]=[
      ['passed',"test('runs',()=>{});",true],
      ['skipped',"test.skip('skipped',()=>{});",false],
      ['todo',"test.todo('pending');",false],
      ['mixed',"test('runs',()=>{});test.skip('skipped',()=>{});",false],
      ['empty','',false],
      ['failed',"test('fails',()=>{throw Error('fixture failure')});",false],
    ];
    for (const [name,body,expected] of fixtures) {
      const path=join(dir,name+'.mjs');
      writeFileSync(path,"import test from 'node:test';\n"+body);
      const result=spawnSync('bash',['-ec','set -o pipefail; TEST_FILES=("$1");\n'+stage,'fixture',path],{env,encoding:'utf8'});
      assert.equal(result.status===0,expected,name+': '+result.stdout+result.stderr);
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});
