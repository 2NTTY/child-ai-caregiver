import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import ts from 'typescript';
const require = createRequire(import.meta.url), root = process.env.RECOVERY_TEST_ROOT ?? path.resolve(import.meta.dirname, '../..');
function compile(file, resolve, suffix = '') {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  const exports = {}; new Function('require', 'exports', code + suffix)(resolve, exports); return exports;
}
function hooks() {
  const slots = []; let cursor = 0, effects = [];
  const slot = create => { const i = cursor++; if (!(i in slots)) slots[i] = create(); return i; };
  const effect = (fn, deps) => { const i = cursor++, old = slots[i]; if (!old || !deps || deps.some((d, k) => !Object.is(d, old.deps[k]))) {
    effects.push(() => { old?.cleanup?.(); slots[i] = {deps, cleanup: fn()}; }); } };
  return {reset() {cursor = 0; effects = [];}, flush() {for (const effect of effects) effect();}, unmount() {for (const s of slots) s?.cleanup?.();},
    react: {useState(v) {const i = slot(() => typeof v === 'function' ? v() : v); return [slots[i], n => {slots[i] = typeof n === 'function' ? n(slots[i]) : n;}];},
      useRef(v) {return slots[slot(() => ({current: v}))];}, useMemo(fn) {return slots[slot(fn)];}, useEffect: effect, useLayoutEffect: effect,
      createContext: () => ({Provider: 'Provider'}), memo: v => v, useContext: () => null, useCallback: fn => fn}};
}
class ApiError extends Error {constructor(status = 0, onlineCode = null, confirmed = false) {super('Synthetic request failure'); Object.assign(this, {status, onlineCode, confirmed});}}
const settle = async () => {await new Promise(resolve => setTimeout(resolve, 0));};
const photo = {id: 'photo-a', childId: 'child-a', ownerUserId: 'synthetic-parent', version: 1, visibility: 'private', canManage: true,
  state: 'ready', recordId: null, source: 'Synthetic photo', mimeType: 'image/png', bytes: 1, sha256: 'a'.repeat(64), extraction: {state: 'not_requested', draft: null}};
const input = {id: 'source-a', childId: 'child-a', ownerUserId: 'synthetic-parent', version: 1, canManage: true, kind: 'paste', recordId: null,
  text: 'Synthetic source text', management: null, fetchState: 'not_requested', extraction: {state: 'not_requested', draft: null}};
const emptyPhotoDraft = () => ({text: ''});
function fixture(kind, targetPatch = {}) {
  const h = hooks(), target = {...(kind === 'photos' ? photo : input), ...targetPatch};
  let pathname = '/' + kind, view, guard, deleted = false, listError = null, resourceError = null, listReads = 0, resets = 0, denied = [], current = true, blockRead = null;
  const api = {resetOnline() {resets++;}, hasPendingOnline: () => false,
    async photos() {listReads++; if (blockRead) await blockRead; if (listError) throw listError; return {photos: deleted ? [] : [target], canCreate: true};},
    async inputs() {listReads++; if (blockRead) await blockRead; if (listError) throw listError; return {inputs: deleted ? [] : [target], sources: [], canCreate: true};},
    async photo() {if (resourceError) throw resourceError; if (deleted) throw new ApiError(404); return target;},
    async input() {if (resourceError) throw resourceError; if (deleted) throw new ApiError(404); return target;},
    async content() {return new Blob(['x']);}};
  let attachments = []; const draftListeners = new Set();
  const draftOwner = {getSnapshot: () => ({scope: 'child-a', attachments}), subscribe: listener => {draftListeners.add(listener); return () => draftListeners.delete(listener);}};
  const env = {owner: {draftOwner}, apiBaseUrl: '/api', scopeKey: 'child-a', childId: 'child-a', childName: 'A', userId: 'synthetic-parent', role: 'owner', online: true,
    current: () => current, currentIdentity: () => current, canStartWrite: () => true, invalidate() {}, accessError(error) {denied.push(error);},
    queryClient: {fetchQuery: ({queryFn}) => queryFn()}};
  const resolve = name => {
    if (name === 'react') return h.react;
    if (name === 'react/jsx-runtime') return {jsx: () => null, jsxs: () => null};
    if (name === 'react-native') return {Platform: {OS: 'web'}};
    if (name === 'expo-router') return {usePathname: () => pathname, useGlobalSearchParams: () => ({view})};
    if (name.includes('/photo-api')) return {createPhotoApi: () => api, PhotoApiError: ApiError};
    if (name.includes('/shared-input-api')) return {createSharedInputApi: () => api, SharedInputApiError: ApiError};
    if (name.includes('/use-online-updates')) return {ONLINE_REFRESH_EVENT: 'refresh'};
    if (name.includes('/photo-view-model')) return {emptyPhotoDraft, samePhotoOriginal: () => true};
    if (name === './useDomainEnvironment') return {useDomainEnvironment: () => env, useDomainWriteGuard(dirty, pending) {guard = {dirty: !!dirty, pending, scope: 'child'};}};
    if (name.includes('/PreviewNavigationGuard')) return {usePreviewNavigation: () => action => action()};
    if (name === './ProductionProvider') return {useProduction: () => ({})};
    if (name === './usePhotoInputSources') return {};
    if (name.includes('/photo-form')) return {photoDraftSchema: {safeParse: () => ({success: true})}};
    if (name.endsWith('/shared/shared-inputs')) return {sharedInputCreateSchema: {safeParse: () => ({success: true})}};
    if (name.endsWith('/shared/photos')) return {photoMetadataSchema: {safeParse: value => ({success: true, data: value})}};
    if (name.includes('/photos') || name.includes('/shared-inputs') || name.includes('/source-form') || name.includes('/source-intake') || name.startsWith('../components') || name === 'react-native-paper') return {};
    throw new Error('Unexpected import: ' + name);
  };
  const load = kind === 'photos' ? compile('frontend/src/production/PhotoInputDomains.tsx', resolve, '\nexports.useProductionPhotos = useProductionPhotos;').useProductionPhotos
    : compile('frontend/src/production/usePhotoInputSources.ts', resolve).usePhotoInputSources;
  const render = () => {h.reset(); const v = load(); h.flush(); return v;};
  return {api, render, env, target, attach(original) {attachments = original ? [{photo: original}] : []; draftListeners.forEach(fn => fn());}, get guard() {return guard;}, get listReads() {return listReads;}, get resets() {return resets;}, get denied() {return denied;},
    set pathname(v) {pathname = v;}, set view(v) {view = v;}, set deleted(v) {deleted = v;}, set listError(v) {listError = v;}, set resourceError(v) {resourceError = v;},
    set current(v) {current = v;}, set blockRead(v) {blockRead = v;}, unmount: h.unmount,
    async ready() {render(); await settle(); return render();}, async open() {const v = await this.ready(); (v.actions.openPhoto ?? v.actions.openInput)(v.model.items[0]); await settle(); return render();}};
}
for (const kind of ['sources', 'photos']) {
  test(kind + ': missing resource does not poison child workspace', async () => {
    const f = fixture(kind); let v = await f.open(); assert.equal(v.model.selected.id, f.target.id);
    f.deleted = true; v.actions.refresh(); await settle(); v = f.render();
    assert.notEqual(v.model.access, 'lost'); assert.equal(v.model.selected, null); assert.equal(v.model.load, 'ready'); assert.equal(v.model.items.length, 0);
    const reads = f.listReads; v.actions.refresh(); await settle(); assert.ok(f.listReads > reads); assert.equal(f.denied.length, 0);
    f.unmount();
  });
}

function navigation(onLeave, getGuard) {
  const h = hooks(), jsx = (type, props) => ({type, props});
  const Dialog = Object.assign(() => null, {Title: 'Title', Content: 'Content', Actions: 'Actions'});
  const {PreviewNavigationGuard} = compile('frontend/src/preview/PreviewNavigationGuard.tsx', name =>
    name === 'react' ? h.react : name === 'react/jsx-runtime' ? {jsx, jsxs: jsx} : name === 'react-native' ? {Platform: {OS: 'web'}, StyleSheet: {create: x => x}} :
    name === 'react-native-paper' ? {Text: 'Text'} : name.includes('/AppDialog') ? {AppDialog: Dialog} : name.includes('/ui') ? {AppButton: 'Button'} :
    name.includes('/theme') ? {colors: {}, typeScale: {}} : name.startsWith('expo-router') || name.includes('browser-history-guard') ? {} : assert.fail(name));
  const render = () => {h.reset(); return PreviewNavigationGuard({children: null});};
  const all = value => !value || typeof value !== 'object' ? [] : [value, ...(Array.isArray(value) ? value : [value.props?.children]).flatMap(all)];
  let tree = render(); tree.props.value.register('workspace', getGuard()); tree.props.value.request(onLeave); tree = render();
  return {confirm() {tree.props.value.register('workspace', getGuard()); all(tree).find(node => node.props?.label === '捨棄草稿並離開').props.onPress();},
    cancel() {all(tree).find(node => node.props?.label === '繼續編輯').props.onPress();}};
}
for (const kind of ['sources', 'photos']) {
  test(kind + ': approved route departure discards only ordinary drafts', async () => {
    const f = fixture(kind); let v = await f.open();
    if (kind === 'sources') v.actions.management.edit({intention: 'Synthetic unsaved purpose'});
    else v.actions.editDraft({text: 'Synthetic unsaved photo record'});
    v = f.render(); assert.equal(f.guard.dirty, true);
    const dirty = () => kind === 'sources' ? f.render().model.managementDraft?.dirty : !!f.render().model.draft.text;
    assert.equal(dirty(), true, 'ordinary rerenders retain the draft');
    navigation(() => {f.pathname = '/tasks';}, () => f.guard).cancel(); assert.equal(dirty(), true, 'cancel retains the draft');
    navigation(() => {f.pathname = '/tasks';}, () => f.guard).confirm(); f.render(); v = f.render();
    assert.equal(f.guard.dirty, false); assert.equal(v.model.selected, null); assert.equal(v.model.draft.text, '');
    if (kind === 'sources') assert.equal(v.model.managementDraft, null);
    f.unmount();
  });
  test(kind + ': resource 404 rechecks child access and revocation stays fail-closed', async () => {
    const f = fixture(kind); const v = await f.open();
    f.resourceError = new ApiError(404); f.listError = new ApiError(404);
    if (kind === 'sources') v.actions.newInput(); // Explicitly leave the current editor before reopening the same resource.
    (v.actions.openPhoto ?? v.actions.openInput)(v.model.items[0]); await settle();
    const lost = f.render(); assert.equal(lost.model.access, 'lost'); assert.equal(lost.model.selected, null); assert.deepEqual(lost.model.items, []);
    assert.equal(f.denied.at(-1).status, 403); assert.equal(f.denied.at(-1).code, 'access_denied'); f.unmount();
  });
  test(kind + ': inconclusive access check hides stale data and can recover', async () => {
    const f = fixture(kind); const v = await f.open();
    f.resourceError = new ApiError(404); f.listError = new ApiError(503);
    if (kind === 'sources') v.actions.newInput(); // Explicitly leave the current editor before reopening the same resource.
    (v.actions.openPhoto ?? v.actions.openInput)(v.model.items[0]); await settle(); let next = f.render();
    assert.notEqual(next.model.access, 'lost'); assert.equal(next.model.selected, null); assert.deepEqual(next.model.items, []); assert.equal(next.model.load, 'error');
    f.listError = null; f.deleted = true; next.actions.refresh(); await settle(); next = f.render();
    assert.equal(next.model.load, 'ready'); assert.equal(f.denied.length, 0); f.unmount();
  });
  test(kind + ': unknown operation remains guarded across route cleanup and missing resource', async () => {
    const f = fixture(kind, {extraction: {state: 'unknown', runId: 'original-run', draft: null}}); let v = await f.open();
    assert.equal(f.guard.pending, true); assert.equal(v.model.operation.state, 'unknown');
    f.pathname = '/tasks'; f.render(); v = f.render(); assert.equal(f.guard.pending, true); assert.equal(v.model.selected.id, f.target.id);
    f.deleted = true; v.actions.refresh(); await settle(); v = f.render();
    assert.equal(f.guard.pending, true); assert.notEqual(v.model.access, 'lost'); assert.equal(v.model.selected, null); assert.equal(v.model.operation.state, 'unknown');
    const reads = f.listReads; v.actions.checkOriginal(); await settle(); assert.ok(f.listReads > reads); assert.equal(f.resets, 0); f.unmount();
  });
  test(kind + ': late access revalidation cannot publish after scope changes', async () => {
    const f = fixture(kind); const v = await f.open(); let release;
    f.resourceError = new ApiError(404); f.blockRead = new Promise(resolve => {release = resolve;});
    if (kind === 'sources') v.actions.newInput(); // Explicitly leave the current editor before reopening the same resource.
    (v.actions.openPhoto ?? v.actions.openInput)(v.model.items[0]); await settle(); f.current = false; release(); await settle();
    assert.deepEqual(f.render().model.items, []); assert.equal(f.render().model.selected, null); f.unmount();
  });
}
test('photos: original ownership survives chat-to-Photos entry and releases on approved departure', async () => {
  const f = fixture('photos'); f.pathname = '/chat'; await f.ready();
  const bytes = new Uint8Array([1]), encoded = btoa(String.fromCharCode(...bytes));
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
  const original = {fileName: 'synthetic.png', mimeType: 'image/png', bytes: 1, sha256, imageSource: {uri: 'synthetic'}, readBase64: async () => encoded};
  f.attach(original);
  assert.equal(await f.render().receiveComposerOriginal(original), true); const owned = f.render().model.original;
  f.pathname = '/photos'; f.render(); assert.equal(f.render().model.original, owned); assert.equal(await owned.readBase64(), encoded);
  navigation(() => {f.pathname = '/tasks';}, () => f.guard).confirm(); f.render(); assert.equal(f.render().model.original, null);
  await assert.rejects(owned.readBase64(), /Original released/); f.unmount();
});

test('photos: leaving the legacy Care photo view clears its ordinary draft', async () => {
  const f = fixture('photos'); f.pathname = '/care'; f.view = 'photos'; const v = await f.open();
  v.actions.editDraft({text: 'Synthetic draft in legacy photo route'}); f.render(); assert.equal(f.guard.dirty, true);
  navigation(() => {f.view = undefined;}, () => f.guard).confirm(); f.render(); assert.equal(f.render().model.draft.text, ''); assert.equal(f.guard.dirty, false); f.unmount();
});
test('sources: retained stack screens unmount local forms outside the active route', () => {
  let pathname = '/sources';
  const {default: SourcesPage} = compile('frontend/src/screens/SourcesScreen.tsx', name => name === 'expo-router' ? {usePathname: () => pathname, useRouter: () => ({})} :
    name === 'react/jsx-runtime' ? {jsx: (type, props) => ({type, props})} : name.includes('ProductionProvider') ? {useProduction: () => ({model: {children: [{id: 'child-a'}], selectedChildId: 'child-a'}, actions: {}})} :
    name.includes('PreviewNavigationGuard') ? {usePreviewNavigation: () => () => {}} : {});
  assert.notEqual(SourcesPage(), null); pathname = '/tasks'; assert.equal(SourcesPage(), null);
});

for (const kind of ['sources', 'photos']) {
  test(kind + ': pending receipt payload survives departure without retry or reset', async () => {
    const f = fixture(kind); await f.ready(); let release, submitted, calls = 0;
    const pending = new Promise(resolve => {release = resolve;});
    f.api.hasPendingOnline = () => true;
    if (kind === 'sources') {
      f.api.create = async (_childId, payload) => {calls++; submitted = payload; await pending; throw new ApiError();};
      f.render().actions.create({kind: 'paste', text: 'Synthetic pending text'});
    } else {
      f.api.reserve = async (_childId, payload) => {calls++; submitted = payload; await pending; throw new ApiError();};
      f.render().actions.pickOriginal({fileName: 'synthetic.png', mimeType: 'image/png', bytes: 1, sha256: 'a'.repeat(64), imageSource: {uri: 'synthetic'}, readBase64: async () => 'AQ=='});
      f.render().actions.upload();
    }
    f.render(); assert.equal(f.guard.pending, true); const originalPayload = submitted;
    f.pathname = '/tasks'; f.render(); assert.equal(f.guard.pending, true);
    release(); await settle(); const next = f.render();
    assert.equal(next.model.operation.state, 'unknown'); assert.equal(f.guard.pending, true); assert.equal(calls, 1); assert.equal(submitted, originalPayload); assert.equal(f.resets, 0);
    if (kind === 'photos') assert.equal(next.model.original.fileName, 'synthetic.png');
    f.unmount();
  });
}

for (const extractionState of ['unknown', 'running']) {
  test('photos: ' + extractionState + ' metadata retains the original run when content is missing', async () => {
    const f = fixture('photos', {extraction: {state: extractionState, runId: 'original-run', draft: null}});
    let contentReads = 0, resourceReads = 0;
    f.api.content = async () => {contentReads++; throw new ApiError(404);};
    f.api.photo = async (childId, id, _signal, userId) => {
      resourceReads++; assert.equal(childId, 'child-a'); assert.equal(id, 'photo-a'); assert.equal(userId, 'synthetic-parent'); return f.target;
    };
    f.api.extract = async () => assert.fail('Reconciliation must not repeat extraction');
    let v = await f.open();
    assert.equal(f.guard.pending, true); assert.equal(v.model.operation.state, 'unknown'); assert.equal(v.model.selected, null);
    assert.equal(v.model.original, null); assert.equal(v.model.canPick, false); assert.equal(v.model.canUpload, false); assert.equal(f.resets, 0);
    const reads = resourceReads; v.actions.checkOriginal(); await settle(); v = f.render();
    assert.equal(resourceReads, reads + 1); assert.equal(contentReads, 1); assert.equal(f.guard.pending, true);
    assert.equal(v.model.operation.state, 'unconfirmed'); assert.equal(v.model.selected.extraction.state, extractionState); assert.equal(v.model.canPick, false);
    f.unmount();
  });
}
test('photos: missing content followed by true child revocation clears the known original run', async () => {
  const f = fixture('photos', {extraction: {state: 'unknown', runId: 'original-run', draft: null}});
  const v = await f.ready(); f.api.content = async () => {throw new ApiError(404);}; f.listError = new ApiError(404);
  v.actions.openPhoto(v.model.items[0]); await settle(); const denied = f.render();
  assert.equal(denied.model.access, 'lost'); assert.equal(denied.model.selected, null); assert.deepEqual(denied.model.items, []);
  assert.equal(f.guard.pending, false); assert.equal(f.denied.at(-1).status, 403); assert.equal(f.resets, 1); f.unmount();
});
test('photos: late missing-content response after scope exit cannot revalidate or publish', async () => {
  const f = fixture('photos', {extraction: {state: 'running', runId: 'original-run', draft: null}}); let rejectContent;
  const v = await f.ready(); f.api.content = () => new Promise((_resolve, reject) => {rejectContent = reject;});
  v.actions.openPhoto(v.model.items[0]); await settle(); f.render(); const reads = f.listReads;
  f.current = false; rejectContent(new ApiError(404)); await settle();
  assert.equal(f.listReads, reads); assert.equal(f.render().model.selected, null); assert.equal(f.denied.length, 0); f.unmount();
});

for (const extractionState of ['unknown', 'running']) {
  test('photos: A preview is released before B ' + extractionState + ' content failure and reconciliation', async () => {
    const f = fixture('photos'), b = {...photo, id: 'photo-b', source: 'Synthetic B', extraction: {state: extractionState, runId: 'run-b', draft: null}};
    let photoReads = [], revoked = []; const revoke = URL.revokeObjectURL;
    URL.revokeObjectURL = value => {revoked.push(value); revoke(value);};
    try {
      f.api.photos = async () => ({photos: [photo, b], canCreate: true});
      f.api.photo = async (_childId, id) => {photoReads.push(id); return id === 'photo-b' ? b : photo;};
      f.api.content = async target => {if (target.id === 'photo-b') throw new ApiError(503); return new Blob(['A']);};
      let v = await f.open(); const aUrl = v.model.selected.imageSource.uri; assert.equal(v.model.selected.id, 'photo-a');
      v.actions.openPhoto(v.model.items.find(item => item.id === 'photo-b')); await settle(); v = f.render();
      assert.ok(revoked.includes(aUrl)); assert.equal(v.model.selected, null); assert.equal(v.model.source, 'Synthetic B');
      assert.equal(f.guard.pending, true); assert.equal(v.model.operation.state, 'unknown'); assert.equal(v.model.canPick, false);
      const reads = photoReads.length; v.actions.checkOriginal(); await settle(); v = f.render();
      assert.deepEqual(photoReads.slice(reads), ['photo-b']); assert.equal(v.model.selected.id, 'photo-b');
      assert.equal(v.model.selected.imageSource, null); assert.equal(v.model.source, 'Synthetic B'); assert.equal(f.guard.pending, true);
      assert.equal(v.model.operation.state, 'unconfirmed'); assert.equal(v.model.canPick, false); f.unmount();
    } finally {URL.revokeObjectURL = revoke;}
  });
}
test('photos: same-child late A content cannot race a B selection past the busy lock', async () => {
  const f = fixture('photos'), b = {...photo, id: 'photo-b', source: 'Synthetic B', extraction: {state: 'unknown', runId: 'run-b', draft: null}};
  const reads = []; let releaseA;
  f.api.photos = async () => ({photos: [photo, b], canCreate: true});
  f.api.photo = async (_childId, id) => {reads.push(id); return id === 'photo-b' ? b : photo;};
  f.api.content = target => target.id === 'photo-a' ? new Promise(resolve => {releaseA = resolve;}) : Promise.reject(new ApiError(503));
  let v = await f.ready(); v.actions.openPhoto(v.model.items[0]); await settle(); v = f.render();
  v.actions.openPhoto(v.model.items[1]); assert.deepEqual(reads, ['photo-a']); assert.equal(f.guard.pending, true);
  releaseA(new Blob(['A'])); await settle(); v = f.render(); assert.equal(v.model.selected.id, 'photo-a');
  v.actions.openPhoto(v.model.items.find(item => item.id === 'photo-b')); await settle(); v = f.render();
  assert.deepEqual(reads, ['photo-a', 'photo-b']); assert.equal(v.model.selected, null);
  v.actions.checkOriginal(); await settle(); v = f.render(); assert.equal(v.model.selected.id, 'photo-b'); assert.equal(v.model.selected.imageSource, null); f.unmount();
});
test('photos: A preview and B unresolved state are both cleared on child revocation', async () => {
  const f = fixture('photos'), b = {...photo, id: 'photo-b', source: 'Synthetic B', extraction: {state: 'unknown', runId: 'run-b', draft: null}};
  let revoked = []; const revoke = URL.revokeObjectURL; URL.revokeObjectURL = value => {revoked.push(value); revoke(value);};
  try {
    f.api.photos = async () => ({photos: [photo, b], canCreate: true});
    f.api.photo = async (_childId, id) => id === 'photo-b' ? b : photo;
    f.api.content = async target => {if (target.id === 'photo-b') throw new ApiError(403); return new Blob(['A']);};
    let v = await f.open(); const aUrl = v.model.selected.imageSource.uri;
    v.actions.openPhoto(v.model.items.find(item => item.id === 'photo-b')); await settle(); v = f.render();
    assert.ok(revoked.includes(aUrl)); assert.equal(v.model.access, 'lost'); assert.equal(v.model.selected, null); assert.deepEqual(v.model.items, []);
    assert.equal(f.guard.pending, false); assert.equal(f.denied.at(-1).status, 403); f.unmount();
  } finally {URL.revokeObjectURL = revoke;}
});

test('photos: handoff copies bytes without releasing composer and revalidates scope and access', async () => {
  const f = fixture('photos'); f.pathname = '/chat'; await f.ready();
  let released = false;
  const bytes = new Uint8Array([1]), encoded = btoa(String.fromCharCode(...bytes));
  const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const original = {fileName: 'synthetic.png', mimeType: 'image/png', bytes: 1, sha256, imageSource: {uri: 'synthetic'},
    readBase64: async () => {if (released) throw new Error('Composer released'); return encoded;}, dispose() {released = true;}};
  f.attach(original);
  assert.equal(await f.render().receiveComposerOriginal(original), true);
  let v = f.render(); assert.equal(v.canContinueComposerOriginal(original), true); assert.equal(released, false);
  const owned = v.model.original; assert.notEqual(owned, original);
  f.env.role = 'viewer'; assert.equal(v.canContinueComposerOriginal(original), false);
  f.env.role = 'owner'; f.current = false; assert.equal(v.canContinueComposerOriginal(original), false);
  f.current = true; assert.equal(v.canContinueComposerOriginal({...original}), false);
  // Actual route commit releases the composer. Its independent recipient remains readable.
  f.pathname = '/photos'; original.dispose(); f.render();
  assert.equal(await owned.readBase64(), encoded); assert.equal(f.render().model.original, owned);
  f.unmount(); await assert.rejects(owned.readBase64(), /Original released/);
});

test('photos: child change during byte read cannot publish a transferred original', async () => {
  const f = fixture('photos'); f.pathname = '/chat'; await f.ready(); let release;
  const original = {fileName: 'synthetic.png', mimeType: 'image/png', bytes: 1, sha256: 'a'.repeat(64), imageSource: {uri: 'synthetic'},
    readBase64: () => new Promise(resolve => {release = resolve;})};
  f.attach(original);
  const pending = f.render().receiveComposerOriginal(original); f.current = false; release('AQ==');
  assert.equal(await pending, false); assert.equal(f.render().model.original, null); f.unmount();
});

test('navigation: retaining exact handoff drafts never exempts pending, unrelated dirty or child changes', () => {
  const h = hooks(), jsx = (type, props) => ({type, props});
  const Dialog = Object.assign(() => null, {Title: 'Title', Content: 'Content', Actions: 'Actions'});
  const {PreviewNavigationGuard} = compile('frontend/src/preview/PreviewNavigationGuard.tsx', name =>
    name === 'react' ? h.react : name === 'react/jsx-runtime' ? {jsx, jsxs: jsx} : name === 'react-native' ? {Platform: {OS: 'web'}, StyleSheet: {create: x => x}} :
    name === 'react-native-paper' ? {Text: 'Text'} : name.includes('/AppDialog') ? {AppDialog: Dialog} : name.includes('/ui') ? {AppButton: 'Button'} :
    name.includes('/theme') ? {colors: {}, typeScale: {}} : name.startsWith('expo-router') || name.includes('browser-history-guard') ? {} : assert.fail(name));
  const render = () => {h.reset(); return PreviewNavigationGuard({children: null});};
  const all = value => !value || typeof value !== 'object' ? [] : [value, ...(Array.isArray(value) ? value : [value.props?.children]).flatMap(all)];
  let tree = render(), routes = 0; const guard = tree.props.value, go = () => routes++;
  const ordinary = {dirty: true, pending: false, scope: 'child'};
  guard.register('composer', ordinary); guard.register('photos', ordinary);
  guard.request(go, 'navigation', ['composer', 'photos']); assert.equal(routes, 1);
  guard.request(go); assert.equal(routes, 1, 'ordinary navigation still guards the same drafts');
  guard.register('photos', {...ordinary, pending: true}); guard.request(go, 'navigation', ['composer', 'photos']);
  tree = render(); assert.ok(all(tree).some(n => n.props?.children === '先處理原操作')); assert.equal(routes, 1);
  guard.register('photos', ordinary); guard.register('source', ordinary); guard.request(go, 'navigation', ['composer', 'photos']);
  tree = render(); assert.ok(all(tree).some(n => n.props?.label === '捨棄草稿並離開')); assert.equal(routes, 1);
  all(tree).find(n => n.props?.label === '繼續編輯').props.onPress(); assert.equal(routes, 1);
  guard.remove('source'); guard.request(go, 'child', ['composer', 'photos']); assert.equal(routes, 1);
});

test('chat photo control waits for committed idle owner and keeps composer when navigation is blocked', async () => {
  const f = fixture('photos'); f.pathname = '/chat'; await f.ready();
  const encoded = 'AQ==', sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', new Uint8Array([1]))).toString('hex');
  let disposed = false, sourceAttached = true, route = '/chat', requests = [], domain = f.render();
  const original = {fileName: 'synthetic.png', mimeType: 'image/png', bytes: 1, sha256, imageSource: {uri: 'synthetic'},
    readBase64: async () => encoded, dispose() {disposed = true;}};
  f.attach(original);
  const owner = {getSnapshot: () => ({scopeKey: 'child-a'}), draftOwner: {getSnapshot: () => ({scope: 'child-a', text: 'Keep my question', attachments: sourceAttached ? [{photo: original}] : []})}};
  const h = hooks(), jsx = (type, props) => ({type, props}); h.react.useContext = () => ({photos: domain});
  const {AgentPhotoInput} = compile('frontend/src/production/PhotoInputDomains.tsx', name => {
    if (name === 'react') return h.react;
    if (name === 'react/jsx-runtime') return {jsx, jsxs: jsx};
    if (name === 'expo-router') return {useRouter: () => ({push: path => {route = path;}})};
    if (name === './ProductionProvider') return {useProduction: () => ({owner, scopeKey: 'child-a'})};
    if (name.includes('/PreviewNavigationGuard')) return {usePreviewNavigation: () => (action, intent, retained) => requests.push({action, intent, retained})};
    if (name === '../components/ui') return {AppButton: 'Button', SectionCard: 'Card', SectionHeader: 'Header'};
    if (name === 'react-native') return {View: 'View'};
    if (name === 'react-native-paper') return {Text: 'Text'};
    return {};
  });
  const all = value => !value || typeof value !== 'object' ? [] : [value, ...(Array.isArray(value) ? value : [value.props?.children]).flatMap(all)];
  const render = () => {h.reset(); const tree = AgentPhotoInput({original, composerGuardId: 'composer'}); h.flush(); return tree;};
  let transferPromise; const receive = domain.receiveComposerOriginal;
  domain = {...domain, receiveComposerOriginal: source => transferPromise = receive(source)};
  all(render()).find(n => n.props?.label === '把原照片帶入核對').props.onPress();
  domain = {...f.render(), leaveGuardId: 'photos'}; assert.equal(domain.pending, true); render(); assert.equal(requests.length, 0);
  await transferPromise; domain = {...f.render(), leaveGuardId: 'photos'}; render();
  assert.equal(requests.length, 1); assert.deepEqual(requests[0].retained, ['composer', 'photos']);
  assert.equal(route, '/chat'); assert.equal(disposed, false); assert.equal(sourceAttached, true);
  assert.equal(owner.draftOwner.getSnapshot().text, 'Keep my question');
  f.current = false; requests[0].action(); assert.equal(route, '/chat', 'late child change invalidates the saved navigation callback');
  f.current = true; requests[0].action(); assert.equal(route, '/photos');
  sourceAttached = false; original.dispose(); f.pathname = route; f.render();
  assert.equal(await f.render().model.original.readBase64(), encoded); f.unmount();
});

test('photos: cancelled handoff can replace detached composer source without orphaning recipient bytes', async () => {
  const f = fixture('photos'); f.pathname = '/chat'; await f.ready();
  const original = {fileName: 'synthetic.png', mimeType: 'image/png', bytes: 1,
    sha256: Buffer.from(await crypto.subtle.digest('SHA-256', new Uint8Array([1]))).toString('hex'), imageSource: {uri: 'synthetic'}, readBase64: async () => 'AQ=='};
  f.attach(original); assert.equal(await f.render().receiveComposerOriginal(original), true);
  const owned = f.render().model.original;
  // The navigation guard was cancelled; source replacement happens on the same chat route.
  const replacement = {...original, fileName: 'replacement.png'};
  f.attach(replacement); await settle(); assert.equal(f.render().model.original, null);
  await assert.rejects(owned.readBase64(), /Original released/);
  assert.equal(await f.render().receiveComposerOriginal(replacement), true);
  const nextOwned = f.render().model.original;
  f.pathname = '/photos'; f.render(); f.attach(null); await settle();
  assert.equal(f.render().model.original, nextOwned); assert.equal(await nextOwned.readBase64(), 'AQ=='); f.unmount();
});

test('photos: detached source during asynchronous copy cannot publish an orphaned handoff', async () => {
  const f = fixture('photos'); f.pathname = '/chat'; await f.ready(); let release;
  const original = {fileName: 'synthetic.png', mimeType: 'image/png', bytes: 1,
    sha256: Buffer.from(await crypto.subtle.digest('SHA-256', new Uint8Array([1]))).toString('hex'), imageSource: {uri: 'synthetic'},
    readBase64: () => new Promise(resolve => {release = resolve;})};
  f.attach(original); const pending = f.render().receiveComposerOriginal(original);
  f.attach(null); release('AQ=='); assert.equal(await pending, false); assert.equal(f.render().model.original, null); f.unmount();
});

test('navigation recovery error stays visible and explicit leave still checks dirty and pending', () => {
  const h = hooks(), jsx = (type, props) => ({type, props});
  const Dialog = Object.assign(() => null, {Title: 'Title', Content: 'Content', Actions: 'Actions'});
  let reportError, retries = 0, leaves = 0;
  const {PreviewNavigationGuard} = compile('frontend/src/preview/PreviewNavigationGuard.tsx', name =>
    name === 'react' ? h.react : name === 'react/jsx-runtime' ? {jsx, jsxs: jsx} : name === 'react-native' ? {Platform: {OS: 'web'}, View: 'View', StyleSheet: {create: x => x}} :
    name === 'react-native-paper' ? {Text: 'Text'} : name.includes('/AppDialog') ? {AppDialog: Dialog} : name.includes('/ui') ? {AppButton: 'Button'} :
    name.includes('/theme') ? {colors: {}, typeScale: {}} : name.includes('browser-history-guard') ? {guardBrowserHistory: (_target, _block, _request, report) => {reportError = report;}} : name.startsWith('expo-router') ? {} : assert.fail(name));
  const originalWindow = globalThis.window; globalThis.window = {};
  const render = () => {h.reset(); const tree = PreviewNavigationGuard({children: null}); h.flush(); return tree;};
  const all = value => !value || typeof value !== 'object' ? [] : [value, ...(Array.isArray(value) ? value : [value.props?.children]).flatMap(all)];
  try {
    let tree = render(); const guard = tree.props.value;
    reportError({retry: () => retries++, leave: () => leaves++}); tree = render();
    const alert = all(tree).find(n => n.props?.testID === 'history-recovery-error');
    assert.equal(alert.props.accessibilityRole, 'alert'); assert.ok(all(alert).some(n => String(n.props?.children).includes('網址與目前頁面暫未同步')));
    all(tree).find(n => n.props?.label === '重試返回原頁').props.onPress(); assert.equal(retries, 1);
    guard.register('photo', {dirty: true, pending: true, scope: 'child'});
    all(tree).find(n => n.props?.label === '確認離開目前頁面').props.onPress(); tree = render();
    assert.ok(all(tree).some(n => n.props?.children === '先處理原操作')); assert.equal(leaves, 0);
    guard.register('photo', {dirty: true, pending: false, scope: 'child'});
    all(tree).find(n => n.props?.label === '確認離開目前頁面').props.onPress(); tree = render();
    all(tree).find(n => n.props?.label === '繼續編輯').props.onPress(); tree = render();
    assert.equal(leaves, 0); assert.ok(all(tree).some(n => n.props?.testID === 'history-recovery-error'));
    all(tree).find(n => n.props?.label === '確認離開目前頁面').props.onPress(); tree = render();
    all(tree).find(n => n.props?.label === '捨棄草稿並離開').props.onPress(); assert.equal(leaves, 1);
  } finally {globalThis.window = originalWindow; h.unmount();}
});
