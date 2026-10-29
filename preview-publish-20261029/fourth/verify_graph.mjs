// Portable AST/VLQ parser reused from the reviewed Harbour v3 tool; topology below is original fourth f1 only.
// No historic receipts, paths, grants or previous-product bundles are imported.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
let stage = 'ARGUMENTS';
function main() {
assert.equal(process.argv.length, 4, 'source and raw arguments required');
const source = path.resolve(process.argv[2]), rawRoot = path.resolve(process.argv[3]);
stage = 'RUNTIME_DEPENDENCIES';
const req = createRequire(path.join(source, 'frontend/package.json'));
const parser = req('@babel/parser');
const { TraceMap, decodedMappings } = req('@jridgewell/trace-mapping');
const selectedSources = new Set(['/frontend/index.js','/frontend/src/production/ProductionProvider.tsx','/frontend/src/platform/runtime.ts','/frontend/app/_layout.tsx','/frontend/src/preview/PreviewNavigationGuard.tsx','/frontend/src/production/ProductionFirstScreenGate.tsx']);
const selectedSuffixes=['/expo-router/entry.js','/expo-router/entry-classic.js','/expo-router/build/qualified-entry.js','/expo-router/build/renderRootComponent.js'];
const retainSource=name=>selectedSources.has(name)||selectedSuffixes.some(suffix=>name.endsWith(suffix));
const rawBefore = new Map();
function readPinned(file) { const data = fs.readFileSync(file); rawBefore.set(file, sha(data)); return data; }
function keyOf(p){assert.equal(p.type,'ObjectProperty');assert.equal(p.computed,false);assert(!p.method);if(p.key.type==='Identifier')return p.key.name;assert(['StringLiteral','NumericLiteral'].includes(p.key.type));return String(p.key.value)}
function dependencyProof(node){
 if(!node)return{kind:'omitted',slots:[],paths:[]};if(node.type==='NullLiteral')return{kind:'null',slots:[],paths:[]};
 const slot=(value,index)=>{if(value===null)return{slot:index,kind:'hole'};if(value.type==='NullLiteral')return{slot:index,kind:'null'};assert.equal(value.type,'NumericLiteral','No executable/unknown dependency value');assert(Number.isInteger(value.value)&&value.value>=0);return{slot:index,kind:'module',id:value.value}};
 if(node.type==='ArrayExpression')return{kind:'array',slots:node.elements.map(slot),paths:[]};
 assert.equal(node.type,'ObjectExpression','Unknown Metro dependency container');const slots=[],paths=[],keys=new Set();
 for(const property of node.properties){const key=keyOf(property);assert(!keys.has(key));keys.add(key);if(key==='paths'){assert.equal(property.value.type,'ObjectExpression');const ids=new Set();for(const p of property.value.properties){const k=keyOf(p);assert(/^(0|[1-9][0-9]*)$/.test(k));assert(!ids.has(k));ids.add(k);assert.equal(p.value.type,'StringLiteral');paths.push({id:Number(k),path:Buffer.from(p.value.value).toString()})}}else{assert(/^(0|[1-9][0-9]*)$/.test(key));slots.push(slot(property.value,Number(key)))}}
 slots.sort((a,z)=>a.slot-z.slot);return{kind:'object',slots,paths};
}
// Regex proposes candidate boundaries only. Every byte is covered and every candidate is independently parsed as complete JavaScript.
// A misplaced boundary inside a string/comment/body fails AST shape or exact statement coverage; it can never count as a module.
function parseSpan(span,startLine,file,map,decoded,retainFactory,isLast,isEntry){
 const ast=parser.parse(span,{sourceType:'script'});assert.equal(ast.program.directives.length,0);assert(ast.program.body.length>0);const first=ast.program.body[0];assert.equal(first.type,'ExpressionStatement');const call=first.expression;assert.equal(call.type,'CallExpression');assert.equal(call.callee.type,'Identifier');assert.equal(call.callee.name,'__d');assert([2,3].includes(call.arguments.length));
 const [factory,id,deps]=call.arguments;assert.equal(factory.type,'FunctionExpression');assert.equal(id.type,'NumericLiteral');assert(Number.isInteger(id.value)&&id.value>=0);const sources=new Set();
 for(let line=factory.loc.start.line;line<=factory.loc.end.line;line++)for(const segment of decoded[startLine+line-2]??[]){if(segment.length<4||line===factory.loc.start.line&&segment[0]<factory.loc.start.column||line===factory.loc.end.line&&segment[0]>factory.loc.end.column)continue;assert(segment[1]>=0&&segment[1]<map.sources.length);sources.add(Buffer.from(map.sources[segment[1]]).toString())}
 const body=span.slice(factory.start,factory.end),dep=dependencyProof(deps),numeric=dep.slots.map(r=>r.kind==='module'?r.id:null),boot=[];
 for(const statement of ast.program.body.slice(1)){assert(isLast&&isEntry,'No extra executable statements in optional or nonfinal module span');assert.equal(statement.type,'ExpressionStatement');const c=statement.expression;assert.equal(c.type,'CallExpression');assert.equal(c.callee.type,'Identifier');assert.equal(c.callee.name,'__r');assert.equal(c.arguments.length,1);assert.equal(c.arguments[0].type,'NumericLiteral');assert(Number.isInteger(c.arguments[0].value)&&c.arguments[0].value>=0);boot.push(c.arguments[0].value)}
 return{record:{argumentCount:call.arguments.length,id:id.value,sources:[...sources],factorySha256:sha(body),factoryBytes:Buffer.byteLength(body),factory:retainFactory&&[...sources].some(s=>retainSource(s))?Buffer.from(body).toString():undefined,empty:factory.body.body.length===0,dependencies:numeric,dependencyProof:dep,file,spanStartLine:startLine,spanLines:span.split('\n').length,spanBytes:Buffer.byteLength(span),factorySourceRange:{startLine:startLine+factory.loc.start.line-1,startColumn:factory.loc.start.column,endLine:startLine+factory.loc.end.line-1,endColumn:factory.loc.end.column}},boot,statementCount:ast.program.body.length};
}
function parseBundle(file) {
  stage = 'BUNDLE_MAP';
  const full = path.join(rawRoot, '_expo/static/js/web', file);
  const raw = readPinned(full), text = raw.toString();
  assert(Buffer.from(text).equals(raw), 'Exact UTF-8');
  const mapRaw = readPinned(full + '.map'), map = JSON.parse(mapRaw.toString());
  const decoded = decodedMappings(new TraceMap(map));
  assert.equal(map.sources.length, map.sourcesContent.length);
  const starts = [...text.matchAll(/^__d\(/gm)].map(m => m.index);
  assert(starts.length, 'Actual module registrations required');
  stage = 'BUNDLE_PREFIX';
  const prefix = text.slice(0, starts[0]), prefixAst = parser.parse(prefix, { sourceType: 'script' });
  assert.equal(prefixAst.program.directives.length, 0);
  for (const n of prefixAst.program.body) {
    const c = n.expression;
    assert(!(c?.type === 'CallExpression' && c.callee?.type === 'Identifier' && ['__d', '__r'].includes(c.callee.name)), 'Missed prefix registration/boot');
  }
  const isEntry = file.startsWith('index-');
  if (!isEntry) assert.equal(prefixAst.program.body.length, 0);
  stage = 'SELECTED_SOURCE_BINDING';
  const selectedSourceContents = {};
  for (let i = 0; i < map.sources.length; i++) {
    const name = map.sources[i];
    if (!retainSource(name)) continue;
    const bytes = readPinned(path.join(source, name.slice(1)));
    assert.equal(map.sourcesContent[i], bytes.toString(), 'Selected source map bytes');
    selectedSourceContents[name] = map.sourcesContent[i];
  }
  stage = 'BUNDLE_FACTORIES';
  const records = [], bootCalls = [], coverage = crypto.createHash('sha256');
  coverage.update(prefix);
  let coveredBytes = Buffer.byteLength(prefix), startLine = prefix.split('\n').length, maxSpanBytes = 0;
  for (let i = 0; i < starts.length; i++) {
    const span = text.slice(starts[i], starts[i + 1] ?? text.length), bytes = Buffer.byteLength(span);
    assert(bytes <= 2 * 1024 * 1024, 'Bounded per-factory parser allocation');
    const value = parseSpan(span, startLine, file, map, decoded, true, i === starts.length - 1, isEntry);
    records.push(value.record); bootCalls.push(...value.boot);
    coverage.update(span); coveredBytes += bytes;
    maxSpanBytes = Math.max(maxSpanBytes, bytes);
    startLine += span.split('\n').length - 1;
  }
  assert.equal(coveredBytes, raw.length);
  assert.equal(coverage.digest('hex'), sha(raw));
  assert(isEntry ? bootCalls.length > 0 : bootCalls.length === 0);
  return { records, summary: { file, ids: records.map(r => r.id), sha256: sha(raw), mapSha256: sha(mapRaw), prefixSha256: sha(prefix), bootCalls, maxSpanBytes, exactFullByteCoverage: true }, selectedSourceContents };
}
stage = 'BUNDLE_DISCOVERY';
const folder = path.join(rawRoot, '_expo/static/js/web');
const files = fs.readdirSync(folder).filter(n => n.endsWith('.js')).sort();
assert(files.length>0);assert.equal(files.filter(file=>file.startsWith('index-')).length,1);
const modules = new Map(), bundles = [], selected = {};
for (const file of files) {
  const parsed = parseBundle(file);
  for (const row of parsed.records) {
    assert(!modules.has(row.id), 'Duplicate registered module');
    modules.set(row.id, row);
  }
  bundles.push(parsed.summary); Object.assign(selected, parsed.selectedSourceContents);
}
stage = 'GRAPH_EDGES';
let numericEdges = 0, asyncPaths = 0;
for (const row of modules.values()) {
  for (const slot of row.dependencyProof.slots) if (slot.kind === 'module') {
    assert(modules.has(slot.id), 'Unresolved numeric edge'); numericEdges++;
  }
  for (const p of row.dependencyProof.paths) {
    assert(modules.has(p.id));
    assert(/^\/_expo\/static\/js\/web\/[A-Za-z0-9_.-]+\.js$/.test(p.path));
    assert.equal(modules.get(p.id).file, path.basename(p.path));
    assert(bundles.some(x => x.file === path.basename(p.path))); asyncPaths++;
  }
}
for (const id of bundles.flatMap(b => b.bootCalls)) assert(modules.has(id), 'Missing boot module');
const bySource = name => {
  const matches = [...modules.values()].filter(row => row.sources.includes(name));
  assert.equal(matches.length, 1, name); return matches[0];
};
const identity = id => {
  const row = modules.get(id); assert(row);
  return row.sources.length ? row.sources.join('|') : 'unmapped:' + row.factorySha256;
};
const suffix = name => { const matches=[...modules.values()].filter(row=>row.sources.some(s=>s.endsWith(name)));assert.equal(matches.length,1,name);return matches[0]; };
stage = 'ENTRY_BINDING';
const entry=bySource('/frontend/index.js'),owner=bySource('/frontend/src/production/ProductionProvider.tsx');
assert.equal(entry.dependencies.length,4);
const slots=entry.dependencies.map((id,slot)=>({slot,id,sources:modules.get(id).sources}));
const platform=modules.get(slots[0].id);assert.equal(platform.empty,true);assert.deepEqual(platform.sources,[]);
assert.equal(selected['/frontend/src/platform/runtime.ts'],'// Web keeps its browser-provided cryptographic runtime.\nexport {};\n');
assert.deepEqual(slots[1].sources,['/frontend/src/platform/web-foundation.web.ts']);
assert.deepEqual(slots[2].sources,['/frontend/src/preview/browser-history-events.ts']);
assert(slots[3].sources[0].endsWith('/expo-router/entry.js'));
stage = 'ROUTER_NODES';
const nodes={entry,owner,routerEntry:suffix('/expo-router/entry.js'),classic:suffix('/expo-router/entry-classic.js'),qualified:suffix('/expo-router/build/qualified-entry.js'),render:suffix('/expo-router/build/renderRootComponent.js'),ctx:suffix('/expo-router/_ctx.web.js'),expoRoot:suffix('/expo-router/build/ExpoRoot.js'),head:suffix('/expo-router/build/head/index.js'),expo:suffix('/expo/src/Expo.ts'),layout:bySource('/frontend/app/_layout.tsx'),guard:bySource('/frontend/src/preview/PreviewNavigationGuard.tsx'),gate:bySource('/frontend/src/production/ProductionFirstScreenGate.tsx')};
stage = 'REGISTRATION_WEB';
nodes.register=suffix('/expo/src/launch/registerRootComponent.web.tsx');
stage = 'ORIGINAL_EDGES';
const expectedEdges=[['routerEntry','classic'],['classic','qualified'],['classic','render'],['qualified','ctx'],['qualified','expoRoot'],['qualified','head'],['render','expo'],['expo','register'],['layout','owner'],['layout','guard'],['layout','gate']];
for(const [parent,child] of expectedEdges)assert(nodes[parent].dependencies.includes(nodes[child].id),parent+' -> '+child);
stage = 'FACTORY_MARKERS';
for(const marker of ['.ExpoRoot','.ctx','.Provider'])assert(nodes.qualified.factory.includes(marker));
assert(nodes.render.factory.includes('registerRootComponent'));
stage = 'ROUTER_CONTEXT';
assert.equal(nodes.ctx.dependencies.length,1);const context=modules.get(nodes.ctx.dependencies[0]);
assert.equal(context.sources.length,1);assert(context.sources[0].startsWith('/frontend/app?ctx='));
const indexBundle=bundles.find(row=>row.file.startsWith('index-'));
const indexMap=JSON.parse(fs.readFileSync(path.join(folder,indexBundle.file+'.map'),'utf8'));
const contextText=indexMap.sourcesContent[indexMap.sources.indexOf(context.sources[0])];
const targets=[...contextText.matchAll(/require\("([^"]+)"\)/g)].map(match=>match[1]);
assert.equal(context.dependencies.length,targets.length);
const contextTargets=context.dependencies.map((id,i)=>{
 const rel=path.relative(source,targets[i]).split(path.sep).join('/');assert(rel.startsWith('frontend/app/')&&!rel.includes('..'));assert.deepEqual(modules.get(id).sources,['/'+rel]);return rel;
});
assert(contextTargets.includes('frontend/app/_layout.tsx'));assert.equal(indexBundle.bootCalls.at(-1),entry.id);
stage = 'INPUT_READBACK';
for(const [file,hash] of rawBefore)assert.equal(sha(fs.readFileSync(file)),hash,'Verifier input drift');
stage = 'SAFE_PROOF';
const proof={status:'FOURTH_REMOTE_FULL_FACTORY_AST_AND_MODULE_EDGE_CLOSURE_NOT_BROWSER',registeredModules:modules.size,numericEdges,asyncPaths,bundles,entry:{id:entry.id,factorySha256:entry.factorySha256,dependencies:slots},platform:{id:platform.id,emptyFactory:true,sourceSha256:sha(selected['/frontend/src/platform/runtime.ts'])},originalEdges:expectedEdges.map(([parent,child])=>({parent,child,from:nodes[parent].id,to:nodes[child].id})),contextTargets,exactFullByteCoverage:true,inputPrePostHashes:true};
const serialized=JSON.stringify(proof);assert(!serialized.includes(source)&&!serialized.includes(rawRoot),'Private path in graph receipt');process.stdout.write(serialized+'\n');

}
try { main(); }
catch (error) {
  // Never serialize message/stack/actual/expected: they may contain raw code or private paths.
  const codes = new Set(['ERR_ASSERTION','MODULE_NOT_FOUND','ENOENT','EACCES','BABEL_PARSER_SYNTAX_ERROR']);
  const stack = typeof error?.stack === 'string' ? error.stack : String(error);
  const location = stack.match(/\/verify_graph\.mjs:(\d+):(\d+)\)?(?:\n|$)/);
  process.stderr.write(JSON.stringify({format:'fourth-graph-failure-v1',stage,
    code:codes.has(error?.code)?error.code:'OTHER',errorSha256:sha(stack),
    line:location?Number(location[1]):0,column:location?Number(location[2]):0})+'\n');
  process.exitCode = 1;
}
