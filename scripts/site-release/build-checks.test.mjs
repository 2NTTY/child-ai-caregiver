import assert from 'node:assert/strict';
import test from 'node:test';
import {selectBuildChecks} from './build-checks.mjs';
const sha=n=>String(n).repeat(40);
const status={services:{web:{sha:sha(1)},api:{sha:sha(2)},worker:{sha:sha(3)}}};

test('checks use each deployed service baseline and include shared frontend types',()=>{
  const result=selectBuildChecks(status,sha(4),{[sha(1)]:['src/shared/web-push.ts'],[sha(2)]:['server/firebase-http.ts'],[sha(3)]:['server/web-push-gateway.ts']},{web:true,backend:true});
  assert.equal(result.typecheckServer,true);assert.equal(result.typecheckFrontend,true);assert.equal(result.typecheckRoot,true);
  assert.ok(result.tests.includes('tests/firebase-http.test.ts'));
  assert.ok(result.tests.includes('tests/web-push-gateway.test.ts'));
  assert.ok(result.tests.includes('tests/web-push-browser.test.ts'));
});

test('public-only Web updates avoid unrelated typechecks and select worker behavior',()=>{
  const result=selectBuildChecks(status,sha(4),{[sha(1)]:['public/push-sw.js']},{web:true,backend:false});
  assert.equal(result.typecheckServer,false);assert.equal(result.typecheckFrontend,false);assert.equal(result.typecheckRoot,false);
  assert.ok(result.tests.includes('tests/web-push-service-worker.test.ts'));
});

test('unknown and changed cloud tests are never automatically executed',()=>{
  const result=selectBuildChecks(status,sha(4),{[sha(2)]:['server/unknown-new-domain.ts','tests/live-cloud.test.ts'],[sha(3)]:[]},{web:false,backend:true});
  assert.deepEqual(result.unmappedPaths,['server/unknown-new-domain.ts']);
  assert.ok(!result.tests.includes('tests/live-cloud.test.ts'));
  assert.deepEqual(result.unreviewedChangedTests,['tests/live-cloud.test.ts']);
});

test('bootstrap forces all selected typechecks and rejects missing non-bootstrap diffs',()=>{
  const result=selectBuildChecks({services:{web:null,api:null,worker:null}},sha(4),{},{web:true,backend:true});
  assert.equal(result.typecheckServer&&result.typecheckFrontend&&result.typecheckRoot,true);
  assert.throws(()=>selectBuildChecks(status,sha(4),{},{web:true,backend:true}),/Missing complete diff/);
});

test('a handler-only change never selects unrelated config or gateway tests',()=>{
  const result=selectBuildChecks(status,sha(4),{[sha(2)]:['server/firebase-app.ts'],[sha(3)]:[]},{web:false,backend:true});
  assert.deepEqual(result.tests,['tests/firebase-app.test.ts']);
});

test('an unmatched change has no inferred test command',()=>{
  const result=selectBuildChecks(status,sha(4),{[sha(1)]:['licenses/caddy/LICENSE']},{web:true,backend:false});
  assert.deepEqual(result.tests,[]);
});
