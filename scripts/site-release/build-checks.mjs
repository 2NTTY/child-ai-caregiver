import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitDiffs, SHA, validateStatus } from './plan.mjs';

// Reviewed offline tests only: injected authority/storage/browser fixtures, mocked
// DNS/HTTPS, or local file/config parsing. Never infer safety from a test filename.
const rules = [
  { paths: /^(?:server\/firebase-app\.ts|tests\/firebase-app\.test\.ts)$/, tests: ['tests/firebase-app.test.ts'] },
  { paths: /^(?:server\/firebase-http\.ts|tests\/firebase-http\.test\.ts)$/, tests: ['tests/firebase-http.test.ts'] },
  { paths: /^(?:server\/firebase-config\.ts|tests\/firebase-config\.test\.ts)$/, tests: ['tests/firebase-config.test.ts'] },
  { paths: /^(?:server\/web-push-gateway\.ts|tests\/web-push-gateway\.test\.ts)$/, tests: ['tests/web-push-gateway.test.ts'] },
  { paths: /^(?:server\/local-agent-delivery\.ts|tests\/local-web-push-delivery\.test\.ts)$/, tests: ['tests/local-web-push-delivery.test.ts'] },
  { paths: /^(?:public\/push-sw\.js|tests\/web-push-service-worker\.test\.ts)$/, tests: ['tests/web-push-service-worker.test.ts'] },
  { paths: /^(?:src\/client\/(?:push-browser|web-push-api)\.ts|frontend\/src\/production\/(?:WebChatPresenceController|useWebChatPresence|useWebPushNavigation)\.tsx?|tests\/(?:web-push-browser|web-chat-presence-client)\.test\.ts|frontend\/scripts\/web-push-lifecycle\.test\.mjs)$/, tests: ['tests/web-push-browser.test.ts', 'tests/web-chat-presence-client.test.ts', 'frontend/scripts/web-push-lifecycle.test.mjs'] },
  { paths: /^src\/shared\/web-push\.ts$/, tests: ['tests/web-push-browser.test.ts', 'tests/web-chat-presence-client.test.ts', 'tests/web-push-service-worker.test.ts', 'tests/web-push-gateway.test.ts'] },
  { paths: /^(?:src\/config\/api-base-url\.ts|tests\/api-base-url\.test\.ts)$/, tests: ['tests/api-base-url.test.ts'] },
  { paths: /^(?:frontend\/src\/components\/photos\/(?:web-photo-file\.ts|PhotoFilePicker\.web\.tsx)|frontend\/scripts\/web-photo-file\.test\.mts)$/, tests: ['frontend/scripts/web-photo-file.test.mts'] },
  { paths: /^(?:frontend\/app(?:\.config\.js|\.json)|frontend\/plugins\/|scripts\/ios-config\.test\.mjs)/, tests: ['scripts/ios-config.test.mjs'] },
  // The Docker build's existing verifyWebInstallOutput checks the exported HTML,
  // manifest and icons; the release marker test covers the final public overlay.
  { paths: /^(?:frontend\/app\/\+html\.tsx|frontend\/public\/|public\/|scripts\/(?:prepare-web-output|verify-web-install-output|write-site-version)\.mjs)/, tests: ['scripts/site-version.test.mjs'] },
];
const reviewedTests = new Set(rules.flatMap(rule => rule.tests));

export function selectBuildChecks(status, targetSha, diffsBySha, flags) {
  if (!SHA.test(targetSha) || !status?.services || typeof flags.web !== 'boolean' || typeof flags.backend !== 'boolean') throw new Error('Invalid build check inputs');
  function changes(name) {
    const service=status.services[name];
    if (service === null) return { bootstrap:true, paths:[] };
    if (!service || !SHA.test(service.sha)) throw new Error('Invalid deployed service revision');
    if (service.sha === targetSha) return { bootstrap:false, paths:[] };
    const paths=diffsBySha[service.sha];
    if (!Array.isArray(paths)) throw new Error(`Missing complete diff for ${name}`);
    return { bootstrap:false, paths };
  }
  const web=flags.web ? changes('web') : { bootstrap:false, paths:[] };
  const backends=flags.backend ? [changes('api'),changes('worker')] : [];
  const paths=[...new Set([...web.paths,...backends.flatMap(service=>service.paths)])].sort();
  const tests=new Set();
  for (const rule of rules) if (paths.some(path=>rule.paths.test(path))) for (const test of rule.tests) tests.add(test);
  const source=/^(?:server\/|src\/(?:client|config|shared)\/|frontend\/(?:src|app|plugins)\/).*\.[cm]?[jt]sx?$/;
  return {
    revision:targetSha, changedPaths:paths,
    typecheckServer:flags.backend,
    typecheckFrontend:flags.web && (web.bootstrap || web.paths.some(path=>/^(?:frontend\/(?:src\/|app\/|app\.config\.|tsconfig)|src\/(?:client|config|shared)\/|(?:frontend\/)?package(?:-lock)?\.json$)/.test(path))),
    typecheckRoot:flags.web && (web.bootstrap || web.paths.some(path=>/^(?:src\/(?:client|config|shared)\/|tsconfig|(?:frontend\/)?package(?:-lock)?\.json$)/.test(path))),
    tests:[...tests].sort(),
    unmappedPaths:paths.filter(path=>source.test(path) && !rules.some(rule=>rule.paths.test(path))),
    unreviewedChangedTests:paths.filter(path=>/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path) && !reviewedTests.has(path)),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [statusPath,revision,output]=process.argv.slice(2);
    if (!statusPath || !output || !SHA.test(revision ?? '')) throw new Error('Pass preflight status, target SHA and check output path');
    const status=validateStatus(JSON.parse(readFileSync(statusPath,'utf8')));
    const plan=selectBuildChecks(status,revision,gitDiffs(status,revision,process.cwd()),{web:process.env.WEB==='true',backend:process.env.BACKEND==='true'});
    if (plan.unmappedPaths.length) console.warn('No reviewed direct offline test mapping; selected typechecks and candidate HTTP smoke still apply:',JSON.stringify(plan.unmappedPaths));
    if (plan.unreviewedChangedTests.length) console.warn('Not automatically running unreviewed tests:',JSON.stringify(plan.unreviewedChangedTests));
    const run=args=>execFileSync(process.execPath,args,{stdio:'inherit'});
    if (plan.typecheckServer) run(['--max-old-space-size=5120','node_modules/typescript/bin/tsc','--project','tsconfig.server.json','--noEmit','--pretty','false']);
    if (plan.typecheckFrontend) run(['--max-old-space-size=3072','node_modules/typescript/bin/tsc','--project','frontend/tsconfig.json','--noEmit','--pretty','false']);
    if (plan.typecheckRoot) run(['--max-old-space-size=3072','node_modules/typescript/bin/tsc','--project','tsconfig.json','--noEmit','--pretty','false']);
    if (plan.tests.length) run(['--experimental-test-module-mocks','--import','./frontend/scripts/family-cleanup-network-guard.mjs','--test','--test-timeout=60000','--test-concurrency=1',...plan.tests]);
    writeFileSync(output,JSON.stringify({...plan,passed:true},null,2)+'\n',{flag:'wx'});
  } catch (error) { console.error(error.message); process.exitCode=1; }
}
