// Portable current-only core of the existing Harbour v3 AST/VLQ verifier.
// No historic receipts, paths, grants or previous-product bundles are imported.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
assert.equal(process.argv.length, 4, 'source and raw arguments required');
const source = path.resolve(process.argv[2]), rawRoot = path.resolve(process.argv[3]);
const req = createRequire(path.join(source, 'frontend/package.json'));
const parser = req('@babel/parser');
const { TraceMap, decodedMappings } = req('@jridgewell/trace-mapping');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const selectedSources = new Set(['/frontend/index.js', '/frontend/src/entry/Application.tsx', '/frontend/src/production/ProductionProvider.tsx', '/frontend/src/platform/runtime.ts']);
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
 return{record:{argumentCount:call.arguments.length,id:id.value,sources:[...sources],factorySha256:sha(body),factoryBytes:Buffer.byteLength(body),factory:retainFactory&&[...sources].some(s=>selectedSources.has(s))?Buffer.from(body).toString():undefined,empty:factory.body.body.length===0,dependencies:numeric,dependencyProof:dep,file,spanStartLine:startLine,spanLines:span.split('\n').length,spanBytes:Buffer.byteLength(span),factorySourceRange:{startLine:startLine+factory.loc.start.line-1,startColumn:factory.loc.start.column,endLine:startLine+factory.loc.end.line-1,endColumn:factory.loc.end.column}},boot,statementCount:ast.program.body.length};
}
function parseBundle(file) {
  const full = path.join(rawRoot, '_expo/static/js/web', file);
  const raw = readPinned(full), text = raw.toString();
  assert(Buffer.from(text).equals(raw), 'Exact UTF-8');
  const mapRaw = readPinned(full + '.map'), map = JSON.parse(mapRaw.toString());
  const decoded = decodedMappings(new TraceMap(map));
  assert.equal(map.sources.length, map.sourcesContent.length);
  const starts = [...text.matchAll(/^__d\(/gm)].map(m => m.index);
  assert(starts.length, 'Actual module registrations required');
  const prefix = text.slice(0, starts[0]), prefixAst = parser.parse(prefix, { sourceType: 'script' });
  assert.equal(prefixAst.program.directives.length, 0);
  for (const n of prefixAst.program.body) {
    const c = n.expression;
    assert(!(c?.type === 'CallExpression' && c.callee?.type === 'Identifier' && ['__d', '__r'].includes(c.callee.name)), 'Missed prefix registration/boot');
  }
  const isEntry = file.startsWith('index-');
  if (!isEntry) assert.equal(prefixAst.program.body.length, 0);
  const selectedSourceContents = {};
  for (let i = 0; i < map.sources.length; i++) {
    const name = map.sources[i];
    if (!selectedSources.has(name)) continue;
    const bytes = readPinned(path.join(source, name.slice(1)));
    assert.equal(map.sourcesContent[i], bytes.toString(), 'Selected source map bytes');
    selectedSourceContents[name] = map.sourcesContent[i];
  }
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
const folder = path.join(rawRoot, '_expo/static/js/web');
const files = fs.readdirSync(folder).filter(n => n.endsWith('.js')).sort();
assert.equal(files.length, 3);
const modules = new Map(), bundles = [], selected = {};
for (const file of files) {
  const parsed = parseBundle(file);
  for (const row of parsed.records) {
    assert(!modules.has(row.id), 'Duplicate registered module');
    modules.set(row.id, row);
  }
  bundles.push(parsed.summary); Object.assign(selected, parsed.selectedSourceContents);
}
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
const entry = bySource('/frontend/index.js');
const app = bySource('/frontend/src/entry/Application.tsx');
const owner = bySource('/frontend/src/production/ProductionProvider.tsx');
assert.equal(entry.dependencies.length, 5);
assert.match(entry.factory, /r\(d\[0\]\),r\(d\[1\]\),r\(d\[2\]\)/);
assert.match(entry.factory, /renderRootComponent\)\(n\.App\)/);
const slots = entry.dependencies.map((id, slot) => ({ slot, id, sources: modules.get(id).sources }));
assert(slots[0].sources[0].endsWith('/@expo/metro-runtime/src/index.ts'));
assert.equal(slots[2].sources[0], '/frontend/src/preview/browser-history-events.ts');
assert.equal(slots[3].id, app.id);
assert(slots[4].sources[0].endsWith('/expo-router/build/renderRootComponent.js'));
const platform = modules.get(slots[1].id);
assert.equal(platform.empty, true); assert.deepEqual(platform.sources, []);
const platformSource = '/frontend/src/platform/runtime.ts';
assert.equal(selected[platformSource], '// Web keeps its browser-provided cryptographic runtime.\nexport {};\n');
assert.equal(app.dependencies.length, 6); assert.equal(app.dependencies[5], owner.id);
assert.match(app.factory, /\.Provider,null,.*\.ExpoRoot,\{context:.*\.ctx,wrapper:.*\.ProductionOwnerHost\}/);
for (const [slot, suffix] of [[0, '/react/index.js'], [1, '/expo-router/_ctx.web.js'], [2, '/expo-router/build/index.js'], [3, '/expo-router/head.js'], [4, '/expo-router/build/fast-refresh.js']]) assert(identity(app.dependencies[slot]).endsWith(suffix));
const ctx = modules.get(app.dependencies[1]); assert.equal(ctx.dependencies.length, 1);
const context = modules.get(ctx.dependencies[0]);
assert.equal(context.sources.length, 1); assert(context.sources[0].startsWith('/frontend/app?ctx='));
const indexBundle = bundles.find(row => row.file.startsWith('index-'));
const indexMap = JSON.parse(fs.readFileSync(path.join(folder, indexBundle.file + '.map'), 'utf8'));
const contextText = indexMap.sourcesContent[indexMap.sources.indexOf(context.sources[0])];
const targets = [...contextText.matchAll(/require\("([^\"]+)"\)/g)].map(m => m[1]);
assert.equal(context.dependencies.length, targets.length);
const contextTargets = context.dependencies.map((id, i) => {
  const rel = path.relative(source, targets[i]).split(path.sep).join('/');
  assert(rel.startsWith('frontend/app/') && !rel.includes('..'));
  assert.deepEqual(modules.get(id).sources, ['/' + rel]); return rel;
});
assert(contextTargets.includes('frontend/app/_layout.tsx'));
assert.match(owner.factory, /ProductionOwnerHost=/); assert.match(owner.factory, /ProductionProvider=function/);
assert.equal(indexBundle.bootCalls.at(-1), entry.id);
const optional = ['AdminScreenContent', 'AvatarCropPreviewContent'].map((name, i) => {
  const matches = bundles.filter(row => row.file.startsWith(name)); assert.equal(matches.length, 1);
  const row = matches[0]; assert.equal(row.ids.length, [1, 7][i]); assert.equal(row.bootCalls.length, 0);
  return { name, file: row.file, modules: row.ids.map(id => ({ id, sources: modules.get(id).sources, dependencies: modules.get(id).dependencies, factorySha256: modules.get(id).factorySha256 })) };
});
for (const [file, hash] of rawBefore) assert.equal(sha(fs.readFileSync(file)), hash, 'Verifier input drift');
const proof = { status: 'REMOTE_FULL_FACTORY_AST_AND_MODULE_EDGE_CLOSURE_NOT_BROWSER',
  registeredModules: modules.size, numericEdges, asyncPaths,
  bundles, entry: { id: entry.id, factorySha256: entry.factorySha256, dependencies: slots },
  application: { id: app.id, factorySha256: app.factorySha256, orderedDependencies: app.dependencies, ownerHostModule: owner.id },
  platform: { id: platform.id, emptyFactory: true, sourceSha256: sha(selected[platformSource]) },
  contextTargets, optional, exactFullByteCoverage: true, inputPrePostHashes: true };
const serialized = JSON.stringify(proof);
assert(!serialized.includes(source) && !serialized.includes(rawRoot), 'Private path in graph receipt');
process.stdout.write(serialized + '\n');
