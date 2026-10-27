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
const photoDisplay = compile('frontend/src/photo-view-model.ts', name => name === 'luxon' ? require(name) : assert.fail(name));
const blobBytes = compile('src/client/blob-bytes.ts', name => assert.fail(name));
const photoBytes = compile('frontend/src/platform/photo-bytes.ts', name => name.endsWith('/blob-bytes') ? blobBytes : assert.fail(name));
const originalBytes = compile('frontend/src/production/photo-original.ts', name => name === 'base64-js' ? require(name)
  : name.endsWith('/shared/photos') ? require('../../src/shared/photos.ts') : name.endsWith('/platform/photo-bytes') ? photoBytes : assert.fail(name));
function hooks() {
  const slots = []; let cursor = 0, effects = [];
  const slot = create => { const i = cursor++; if (!(i in slots)) slots[i] = create(); return i; };
  const effect = (fn, deps) => { const i = cursor++, old = slots[i]; if (!old || !deps || deps.some((d, k) => !Object.is(d, old.deps[k]))) {
    effects.push(() => { old?.cleanup?.(); slots[i] = {deps, cleanup: fn()}; }); } };
  return {reset() {cursor = 0; effects = [];}, flush() {for (const effect of effects) effect();}, unmount() {for (const s of slots) s?.cleanup?.();},
    react: {useState(v) {const i = slot(() => typeof v === 'function' ? v() : v); return [slots[i], n => {slots[i] = typeof n === 'function' ? n(slots[i]) : n;}];},
      useRef(v) {return slots[slot(() => ({current: v}))];}, useMemo(fn) {return slots[slot(fn)];}, useId: () => String(slot(() => null)), useEffect: effect, useLayoutEffect: effect,
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
  const env = {owner: {draftOwner, setDomainPending() {}}, apiBaseUrl: '/api', scopeKey: 'child-a', childId: 'child-a', childName: 'A', userId: 'synthetic-parent', role: 'owner', online: true,
    current: () => current, currentIdentity: () => current, canStartWrite: () => true, invalidate() {}, accessError(error) {denied.push(error);},
    queryClient: {fetchQuery: ({queryFn}) => queryFn()}};
  const {useDomainWriteGuard} = compile('frontend/src/production/useDomainEnvironment.ts', name => name === 'react' ? h.react
    : name === './ProductionProvider' ? {useProductionOwner: () => env.owner}
      : name.includes('/PreviewNavigationGuard') ? {usePreviewLeaveGuard(dirty, pending, scope, _copy, retainedInWorkspace, pendingKind) {
        guard = {dirty: !!dirty, pending, scope, retainedInWorkspace, pendingKind}; return 'domain-guard';
      }} : assert.fail(name));
  const resolve = name => {
    if (name.includes('/online-refresh-events')) return {subscribeOnlineRefresh: () => () => {}};
    if (name.includes('/blob-bytes')) return blobBytes;
    if (name.includes('/platform/photo-bytes')) return photoBytes;
    if (name === './photo-original') return originalBytes;
    if (name === 'react') return h.react;
    if (name === 'react/jsx-runtime') return {jsx: () => null, jsxs: () => null};
    if (name === 'react-native') return {Platform: {OS: 'web'}};
    if (name === 'expo-router') return {usePathname: () => pathname, useGlobalSearchParams: () => ({view})};
    if (name.includes('/photo-api')) return {createPhotoApi: () => api, PhotoApiError: ApiError};
    if (name.includes('/shared-input-api')) return {createSharedInputApi: () => api, SharedInputApiError: ApiError};
    if (name.includes('/use-online-updates')) return {ONLINE_REFRESH_EVENT: 'refresh'};
    if (name.includes('/photo-view-model')) return {emptyPhotoDraft, samePhotoOriginal: () => true, photoTime: photoDisplay.photoTime};
    if (name === './useDomainEnvironment') return {useDomainEnvironment: () => env, useDomainWriteGuard};
    if (name.includes('/PreviewNavigationGuard')) return {usePreviewNavigation: () => action => action()};
    if (name === './ProductionProvider') return {useProduction: () => ({})};
    if (name === './usePhotoInputSources' || name === './useAttachmentReview') return {};
    if (name.includes('/photo-form')) return {photoDraftSchema: {safeParse: () => ({success: true})}};
    if (name.endsWith('/shared/shared-inputs')) return {sharedInputCreateSchema: {safeParse: () => ({success: true})}};
    if (name.endsWith('/shared/photos')) return {photoMetadataSchema: {safeParse: value => ({success: true, data: value})}};
    if (name.includes('/photos') || name.includes('/shared-inputs') || name.includes('/source-form') || name.includes('/source-intake') || name.startsWith('../components') || name === 'react-native-paper') return {};
    throw new Error('Unexpected import: ' + name);
  };
  const load = kind === 'photos' ? compile('frontend/src/production/PhotoInputDomains.tsx', resolve, '\nexports.useProductionPhotos = useProductionPhotos;').useProductionPhotos
    : compile('frontend/src/production/usePhotoInputSources.ts', resolve).usePhotoInputSources;
  const render = beforeEffects => {h.reset(); const v = load(); beforeEffects?.(v); h.flush(); return v;};
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

function navigation(onLeave, getGuard, intent = 'navigation', retained = []) {
  const h = hooks(), jsx = (type, props) => ({type, props});
  const Dialog = Object.assign(() => null, {Title: 'Title', Content: 'Content', Actions: 'Actions'});
  const {PreviewNavigationGuard} = compile('frontend/src/preview/PreviewNavigationGuard.tsx', name =>
    name === 'react' ? h.react : name === 'react/jsx-runtime' ? {jsx, jsxs: jsx} : name === 'react-native' ? {Platform: {OS: 'web'}, StyleSheet: {create: x => x}} :
    name === 'react-native-paper' ? {Text: 'Text'} : name.includes('/AppDialog') ? {AppDialog: Dialog} : name.includes('/ui') ? {AppButton: 'Button'} :
    name.includes('/theme') ? {colors: {}, typeScale: {}} : name === '../production/routes' ? compile('frontend/src/production/routes.ts', () => assert.fail('Unexpected routes import')) : name.startsWith('expo-router') || name.includes('browser-history-guard') ? {} : assert.fail(name));
  const render = () => {h.reset(); return PreviewNavigationGuard({children: null});};
  const all = value => !value || typeof value !== 'object' ? [] : [value, ...(Array.isArray(value) ? value : [value.props?.children]).flatMap(all)];
  let tree = render(); tree.props.value.register('domain-guard', getGuard()); tree.props.value.request(onLeave, intent, retained); tree = render();
  return {tree, buttons: all(tree).filter(node => node.type === 'Button').map(node => node.props.label), confirm() {tree.props.value.register('domain-guard', getGuard()); all(tree).find(node => node.props?.label === '捨棄並離開').props.onPress();},
    cancel() {all(tree).find(node => node.props?.label === '繼續編輯').props.onPress();}};
}
test('photos: workspace departure guards an unsaved original until explicit discard', async () => {
  const f = fixture('photos'); await f.ready(); let routes = 0, disposals = 0;
  const original = {fileName: 'synthetic.png', mimeType: 'image/png', bytes: 1, sha256: 'a'.repeat(64),
    imageSource: {uri: 'synthetic'}, readBase64: async () => 'AQ==', dispose() {disposals++;}};
  f.render().actions.pickOriginal(original); f.render();
  const leave = () => {routes++; f.pathname = '/tasks';};
  const prompt = navigation(leave, () => f.guard, 'workspace');
  assert.equal(routes, 0, 'workspace navigation must wait for the discard decision');
  assert.deepEqual(prompt.buttons, ['繼續編輯', '捨棄並離開']);
  prompt.cancel(); assert.equal(f.render().model.original, original); assert.equal(disposals, 0);
  navigation(leave, () => f.guard, 'workspace').confirm(); f.render();
  assert.equal(routes, 1); assert.equal(f.render().model.original, null); assert.equal(disposals, 1); f.unmount();
});
for (const readFails of [false, true]) {
  test('photos: approved workspace discard waits for an active read and cleans up after ' + (readFails ? 'failure' : 'success'), async () => {
    const f = fixture('photos'); await f.ready(); let release, disposals = 0;
    const original = {fileName: 'synthetic.png', mimeType: 'image/png', bytes: 1, sha256: 'a'.repeat(64),
      imageSource: {uri: 'synthetic'}, dispose() {disposals++;}};
    f.render().actions.pickOriginal(original); f.render();
    f.blockRead = new Promise(resolve => {release = resolve;}); f.render().actions.refresh();
    assert.equal(f.render().model.busy, true); assert.equal(f.guard.pending, false);
    navigation(() => {f.pathname = '/tasks';}, () => f.guard, 'workspace').confirm(); f.render();
    assert.equal(f.render().model.original, original); assert.equal(disposals, 0);
    if (readFails) f.listError = new ApiError(503);
    release(); await settle(); f.render(); const next = f.render();
    assert.equal(next.model.original, null); assert.equal(next.model.draft.text, ''); assert.equal(disposals, 1);
    assert.equal(f.guard.dirty, false); assert.equal(f.guard.pending, false); f.unmount(); assert.equal(disposals, 1);
  });
}
test('photos: returning to Photos cancels a deferred departure cleanup', async () => {
  const f = fixture('photos'); await f.ready(); let release, disposals = 0;
  const original = {fileName: 'synthetic.png', mimeType: 'image/png', bytes: 1, sha256: 'a'.repeat(64),
    imageSource: {uri: 'synthetic'}, dispose() {disposals++;}};
  f.render().actions.pickOriginal(original); f.render();
  f.blockRead = new Promise(resolve => {release = resolve;}); f.render().actions.refresh(); f.render();
  navigation(() => {f.pathname = '/tasks';}, () => f.guard, 'workspace').confirm(); f.render();
  f.pathname = '/photos'; f.render(); release(); await settle(); f.render();
  assert.equal(f.render().model.original, original); assert.equal(disposals, 0); f.unmount();
});
test('photos: deferred departure cleanup cannot erase a newer editor change', async () => {
  const f = fixture('photos'); await f.ready(); let release, disposals = 0;
  const original = {fileName: 'synthetic.png', mimeType: 'image/png', bytes: 1, sha256: 'a'.repeat(64),
    imageSource: {uri: 'synthetic'}, dispose() {disposals++;}};
  f.render().actions.pickOriginal(original); f.render();
  f.blockRead = new Promise(resolve => {release = resolve;}); f.render().actions.refresh(); f.render();
  navigation(() => {f.pathname = '/tasks';}, () => f.guard, 'workspace').confirm(); f.render();
  release(); await settle();
  const draft = {text: 'Synthetic newer edit after the read settled'};
  f.render(v => v.actions.editDraft(draft)); const next = f.render();
  assert.deepEqual(next.model.draft, draft); assert.equal(next.model.original, original); assert.equal(disposals, 0); f.unmount();
});
test('photos: a successful retry clears only the stale list read error', async () => {
  const f = fixture('photos'); f.listError = new ApiError(503); let v = await f.ready();
  assert.equal(v.model.load, 'error'); assert.match(v.model.notice, /讀取未能確認/); assert.equal(v.model.fresh, false);
  f.listError = null; v.actions.refresh(); await settle(); v = f.render();
  assert.equal(v.model.load, 'ready'); assert.equal(v.model.notice, ''); assert.equal(v.model.fresh, true); assert.equal(v.model.canPick, true);
  f.unmount();
});
test('photos: read error clears only after list and selected photo both recover without losing the draft', async () => {
  const f = fixture('photos'); let v = await f.open();
  const draft = {text: 'Synthetic unsaved recovery draft'}; v.actions.editDraft(draft);
  f.listError = new ApiError(503); f.render().actions.refresh(); await settle(); v = f.render();
  const readError = v.model.notice; assert.match(readError, /讀取未能確認/);
  f.listError = null; f.resourceError = new ApiError(503); v.actions.refresh(); await settle(); v = f.render();
  assert.equal(v.model.load, 'error'); assert.equal(v.model.notice, readError); assert.deepEqual(v.model.draft, draft);
  f.resourceError = null; v.actions.refresh(); await settle(); v = f.render();
  assert.equal(v.model.load, 'ready'); assert.equal(v.model.notice, ''); assert.deepEqual(v.model.draft, draft);
  assert.equal(v.model.selected.id, f.target.id); f.unmount();
});
test('photos: successful reads preserve original and newer picker notices', async () => {
  const f = fixture('photos'); await f.ready();
  const original = {fileName: 'synthetic.png', mimeType: 'image/png', bytes: 1, sha256: 'a'.repeat(64), imageSource: {uri: 'synthetic'}};
  f.render().actions.pickOriginal(original); let v = f.render(); const originalNotice = v.model.notice;
  assert.ok(originalNotice); v.actions.refresh(); await settle(); v = f.render(); assert.equal(v.model.notice, originalNotice);
  f.listError = new ApiError(503); v.actions.refresh(); await settle(); v = f.render(); assert.match(v.model.notice, /讀取未能確認/);
  f.listError = null; let release; f.blockRead = new Promise(resolve => {release = resolve;});
  v.actions.refresh(); f.render().actions.reportFileError('Synthetic newer picker error'); release(); await settle(); v = f.render();
  assert.equal(v.model.load, 'ready'); assert.equal(v.model.notice, 'Synthetic newer picker error'); assert.equal(v.model.original, original); f.unmount();
});
for (const kind of ['sources', 'photos']) {
  test(kind + ': approved route departure discards only ordinary drafts', async () => {
    const f = fixture(kind); let v = await f.open(); const saved = structuredClone(f.target);
    if (kind === 'sources') v.actions.management.edit({intention: 'Synthetic unsaved purpose'});
    else v.actions.editDraft({text: 'Synthetic unsaved photo record'});
    v = f.render(); assert.equal(f.guard.dirty, true);
    const dirty = () => kind === 'sources' ? f.render().model.managementDraft?.dirty : !!f.render().model.draft.text;
    assert.equal(dirty(), true, 'ordinary rerenders retain the draft');
    const intent = kind === 'photos' ? 'workspace' : 'navigation';
    navigation(() => {f.pathname = '/tasks';}, () => f.guard, intent).cancel(); assert.equal(dirty(), true, 'cancel retains the draft');
    navigation(() => {f.pathname = '/tasks';}, () => f.guard, intent).confirm(); f.render(); v = f.render();
    assert.equal(f.guard.dirty, false); assert.equal(v.model.selected, null); assert.equal(v.model.draft.text, '');
    if (kind === 'sources') assert.equal(v.model.managementDraft, null);
    assert.deepEqual(f.target, saved, 'discarding local form content must not delete saved data');
    assert.ok(v.model.items.some(item => item.id === saved.id));
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
  const transfer = navigation(() => {f.pathname = '/photos';}, () => f.guard, 'navigation', ['domain-guard']);
  assert.deepEqual(transfer.buttons, []); f.render(); assert.equal(f.render().model.original, owned); assert.equal(await owned.readBase64(), encoded);
  navigation(() => {f.pathname = '/tasks';}, () => f.guard, 'workspace').confirm(); f.render(); assert.equal(f.render().model.original, null);
  await assert.rejects(owned.readBase64(), /Original released/); f.unmount();
});

test('photos: leaving the legacy Care photo view clears its ordinary draft', async () => {
  const f = fixture('photos'); f.pathname = '/care'; f.view = 'photos'; const v = await f.open();
  v.actions.editDraft({text: 'Synthetic draft in legacy photo route'}); f.render(); assert.equal(f.guard.dirty, true);
  navigation(() => {f.view = undefined;}, () => f.guard, 'workspace').confirm(); f.render(); assert.equal(f.render().model.draft.text, ''); assert.equal(f.guard.dirty, false); f.unmount();
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
    let childChanges = 0;
    const childPrompt = navigation(() => {childChanges++;}, () => f.guard, 'child');
    assert.deepEqual(childPrompt.buttons, ['留在此頁']); assert.equal(childChanges, 0);
    let workspaceChanges = 0;
    const workspace = navigation(() => {workspaceChanges++; f.pathname = '/tasks';}, () => f.guard, 'workspace');
    assert.deepEqual(workspace.buttons, []); assert.equal(workspaceChanges, 1); f.render(); assert.equal(f.guard.pending, true);
    release(); await settle(); const next = f.render();
    assert.equal(next.model.operation.state, 'unknown'); assert.equal(f.guard.pending, true); assert.equal(calls, 1); assert.equal(submitted, originalPayload); assert.equal(f.resets, 0);
    assert.deepEqual(navigation(() => {childChanges++;}, () => f.guard, 'child').buttons, ['留在此頁']); assert.equal(childChanges, 0);
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
  v.actions.openPhoto(v.model.items[1]); assert.deepEqual(reads, ['photo-a']); assert.equal(f.guard.pending, false); assert.equal(v.model.busy, true);
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
    name.includes('/theme') ? {colors: {}, typeScale: {}} : name === '../production/routes' ? compile('frontend/src/production/routes.ts', () => assert.fail('Unexpected routes import')) : name.startsWith('expo-router') || name.includes('browser-history-guard') ? {} : assert.fail(name));
  const render = () => {h.reset(); return PreviewNavigationGuard({children: null});};
  const all = value => !value || typeof value !== 'object' ? [] : [value, ...(Array.isArray(value) ? value : [value.props?.children]).flatMap(all)];
  let tree = render(), routes = 0; const guard = tree.props.value, go = () => routes++;
  const ordinary = {dirty: true, pending: false, scope: 'child'};
  guard.register('composer', ordinary); guard.register('photos', ordinary);
  guard.request(go, 'navigation', ['composer', 'photos']); assert.equal(routes, 1);
  guard.request(go); assert.equal(routes, 1, 'ordinary navigation still guards the same drafts');
  guard.register('photos', {...ordinary, pending: true}); guard.request(go, 'navigation', ['composer', 'photos']);
  tree = render(); assert.ok(all(tree).some(n => n.props?.children === '尚有變更待確認')); assert.equal(routes, 1);
  guard.register('photos', ordinary); guard.register('source', ordinary); guard.request(go, 'navigation', ['composer', 'photos']);
  tree = render(); assert.ok(all(tree).some(n => n.props?.label === '捨棄並離開')); assert.equal(routes, 1);
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
    name.includes('/theme') ? {colors: {}, typeScale: {}} : name === '../production/routes' ? compile('frontend/src/production/routes.ts', () => assert.fail('Unexpected routes import')) : name.includes('browser-history-guard') ? {guardBrowserHistory: (_target, _block, _request, report) => {reportError = report;}} : name.startsWith('expo-router') ? {} : assert.fail(name));
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
    assert.ok(all(tree).some(n => n.props?.children === '尚有變更待確認')); assert.equal(leaves, 0);
    guard.register('photo', {dirty: true, pending: false, scope: 'child'});
    all(tree).find(n => n.props?.label === '確認離開目前頁面').props.onPress(); tree = render();
    all(tree).find(n => n.props?.label === '繼續編輯').props.onPress(); tree = render();
    assert.equal(leaves, 0); assert.ok(all(tree).some(n => n.props?.testID === 'history-recovery-error'));
    all(tree).find(n => n.props?.label === '確認離開目前頁面').props.onPress(); tree = render();
    all(tree).find(n => n.props?.label === '捨棄並離開').props.onPress(); assert.equal(leaves, 1);
  } finally {globalThis.window = originalWindow; h.unmount();}
});

for (const kind of ['sources', 'photos']) {
  test(kind + ': delayed background reads and read failures do not block navigation or child switching', async () => {
    const f = fixture(kind); f.pathname = '/tasks'; let release;
    f.blockRead = new Promise(resolve => {release = resolve;});
    f.render(); let v = f.render();
    assert.equal(v.model.busy, true); assert.equal(v.pending, true, 'local picker and transfer controls stay locked');
    assert.equal(v.model.operation.state, 'none'); assert.equal(f.guard.dirty, false); assert.equal(f.guard.pending, false);
    for (const intent of ['navigation', 'workspace', 'child']) {
      let moved = false; navigation(() => {moved = true;}, () => f.guard, intent); assert.equal(moved, true);
    }
    f.listError = new ApiError(503); release(); await settle(); v = f.render();
    assert.equal(v.model.load, 'error'); assert.equal(v.model.operation.state, 'none'); assert.equal(f.guard.pending, false);
    f.unmount();
  });
  test(kind + ': reading existing unknown work retains its run across workspace navigation but protects scope departure', async () => {
    const f = fixture(kind, {extraction: {state: 'unknown', runId: 'original-run', draft: null}});
    let v = await f.open(), writes = 0;
    f.api.extract = async () => {writes++; assert.fail('Read-only navigation cannot extract');};
    assert.equal(f.guard.pending, true); assert.equal(f.guard.dirty, false);
    navigation(() => {f.pathname = '/tasks';}, () => f.guard, 'workspace'); f.render(); v = f.render();
    assert.equal(v.model.selected.id, f.target.id); if (kind === 'sources') assert.equal(v.model.selected.extraction.runId, 'original-run');
    assert.equal(v.model.operation.state, 'unknown'); assert.equal(f.resets, 0); assert.equal(writes, 0);
    for (const intent of ['child', 'navigation']) {
      let moved = false; const prompt = navigation(() => {moved = true;}, () => f.guard, intent);
      assert.equal(moved, false); assert.deepEqual(prompt.buttons, ['留在此頁']);
    }
    f.pathname = '/' + kind; f.render(); v = f.render();
    assert.equal(v.model.selected.id, f.target.id); assert.equal(f.resets, 0);
    // A later unrelated run must conflict with the original retained basis, not replace it.
    f.api[kind === 'photos' ? 'photo' : 'input'] = async () => ({...f.target, extraction: {...f.target.extraction, runId: 'different-run'}});
    v.actions.checkOriginal(); await settle(); v = f.render();
    assert.equal(v.model.operation.state, 'conflict'); assert.equal(writes, 0); assert.equal(f.resets, 0); f.unmount();
  });
}

for (const kind of ['sources', 'photos']) {
  test(kind + ': modal discard clears only the record draft and retains the saved selection and original attachment', async () => {
    const f = fixture(kind); let v = await f.open(); const saved = structuredClone(f.target);
    v.actions.editDraft({text: 'Synthetic unsaved modal record'}); v = f.render();
    assert.equal(v.model.draft.text, 'Synthetic unsaved modal record');
    if (kind === 'sources') v.actions.discardDraft('record'); else v.actions.discardRecordDraft();
    v = f.render(); assert.equal(v.model.draft.text, ''); assert.equal(v.model.reviewed, null);
    assert.equal(v.model.selected.id, saved.id); assert.deepEqual(f.target, saved); assert.equal(f.resets, 0);
    f.unmount();
  });
  test(kind + ': modal discard never clears an unresolved original operation', async () => {
    const f = fixture(kind, {extraction: {state: 'unknown', runId: 'original-run', draft: null}}); let v = await f.open();
    const operation = structuredClone(v.model.operation), selectedId = v.model.selected.id;
    if (kind === 'sources') for (const type of ['composer', 'record', 'management']) v.actions.discardDraft(type);
    else v.actions.discardRecordDraft();
    v = f.render(); assert.deepEqual(v.model.operation, operation); assert.equal(v.model.selected.id, selectedId);
    assert.equal(f.guard.pending, true); assert.equal(f.resets, 0); f.unmount();
  });
}
test('sources: management modal discard restores the saved settings without changing the selected resource or its history', async () => {
  const f = fixture('sources'); let v = await f.open(); const before = structuredClone(v.model.managementDraft), selectedId = v.model.selected.id;
  v.actions.management.edit({intention: 'Synthetic changed intention'}); v = f.render(); assert.equal(v.model.managementDraft.dirty, true);
  v.actions.discardDraft('management'); v = f.render(); assert.deepEqual(v.model.managementDraft, before);
  assert.equal(v.model.selected.id, selectedId); assert.equal(v.model.intake.selected.stage, 'awaiting_read'); assert.equal(f.resets, 0); f.unmount();
});
