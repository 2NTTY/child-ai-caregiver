import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { harness } from './scope-transition-harness.mjs';

// Actual read hook and gallery with synthetic API and host ports. No production service or model call.
const pending = () => { let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject}; };
const item = id => ({id, childId: 'synthetic-child', version: 1, state: 'ready', createdAt: '2026-10-23T01:00:00Z', fileName: `${id}.pdf`, mimeType: 'application/pdf', bytes: 20, sha256: 'a'.repeat(64), messageId: 'synthetic-message'});
const page = (items = [], nextCursor = null) => ({items, nextCursor, complete: nextCursor === null, scanned: items.length});

function reader() {
  let scope = 'synthetic-a', result; const calls = [], errors = [], requests = [], refreshListeners = new Set();
  const env = () => { const key = scope; return {scopeKey: key, userId: 'synthetic-user', childId: 'synthetic-child', online: true, current: () => scope === key, accessError: error => errors.push(error)}; };
  const api = {list(childId, query, signal, userId) {const value = pending(); calls.push({childId, query, signal, userId}); requests.push(value); return value.promise;}};
  const h = harness({'../../../src/client/online-refresh-events': {subscribeOnlineRefresh: listener => {refreshListeners.add(listener); return () => refreshListeners.delete(listener);}}, './useDomainEnvironment': {useDomainEnvironment: env,forSharedModule:env=>env,useDomainWriteGuard(){}}, '../photo-view-model': {photoTime: value => value}, './VoiceMessage': {VoiceMessage: 'VoiceMessage'}, './ChatFileMessage': {ChatFileMessage: 'ChatFileMessage'}});
  const {useAttachmentList} = h.load('src/production/useAttachmentReview.tsx');
  function Host() {result = useAttachmentList(api); return h.jsx('ReadHost', {});}
  h.render(h.jsx(Host, {}));
  return {...h, api, calls, requests, errors, refresh: () => {for (const listener of refreshListeners) listener(); h.render();}, value: () => result, scope: next => {scope = next; h.render();}, settle: async () => {await Promise.resolve(); await Promise.resolve(); h.render();}};
}

test('an empty scanned page retains its cursor and uses the server policy instead of a hard-coded limit', async () => {
  const h = reader(); assert.deepEqual(h.calls[0].query, {});
  h.requests[0].resolve(page([], 'synthetic-cursor')); await h.settle();
  assert.equal(h.value().state, 'ready'); assert.equal(h.value().items.length, 0); assert.equal(h.value().hasMore, true);
  h.value().loadMore(); assert.deepEqual(h.calls[1].query, {cursor: 'synthetic-cursor'});
  h.requests[1].resolve(page([item('file-b')])); await h.settle(); assert.equal(h.value().items[0].id, 'file-b'); assert.equal(h.value().hasMore, false); h.unmount();
});

test('network failure preserves the same-scope loaded page and cursor for explicit retry', async () => {
  const h = reader(); h.requests[0].resolve(page([item('file-a')], 'cursor-a')); await h.settle();
  h.value().loadMore(); h.requests[1].reject({status: 0, code: 'network_unknown'}); await h.settle();
  assert.equal(h.value().state, 'error'); assert.equal(h.value().items[0].id, 'file-a'); assert.equal(h.value().hasMore, true);
  h.value().loadMore(); h.requests[2].resolve(page([item('file-a'), item('file-b')])); await h.settle();
  assert.deepEqual(h.value().items.map(value => value.id), ['file-a', 'file-b']); h.unmount();
});

test('changing scope aborts the old request and rejects late old-scope data synchronously', async () => {
  const h = reader(); h.scope('synthetic-b'); assert.equal(h.calls[0].signal.aborted, true); assert.equal(h.value().items.length, 0);
  h.requests[0].resolve(page([item('private-old-scope')])); await h.settle(); assert.equal(h.value().items.length, 0);
  h.requests[1].resolve(page([item('new-scope')])); await h.settle(); assert.equal(h.value().items[0].id, 'new-scope'); h.unmount();
});

test('scope-changed clears prior pages and cursor, with an explicit fresh first-page retry', async () => {
  const h = reader(); h.requests[0].resolve(page([item('file-a')], 'cursor-a')); await h.settle();
  h.value().loadMore(); h.requests[1].reject({status: 409, code: 'attachment_scope_changed'}); await h.settle();
  assert.equal(h.value().items.length, 0); assert.equal(h.value().hasMore, false); assert.equal(h.value().state, 'error');
  h.value().refresh(); assert.deepEqual(h.calls[2].query, {}); h.unmount();
});

test('a missing list API is unavailable rather than a successful empty library', async () => {
  const h = reader(); h.requests[0].reject({status: 404, code: 'not_found'}); await h.settle();
  assert.equal(h.value().state, 'unavailable'); assert.equal(h.value().hasMore, false); assert.match(h.value().message, /未接通/); h.unmount();
});

test('only the explicit list-unavailable 503 is unavailable; other failures retain the prior list as stale', async () => {
  // VoiceApiError and ChatFileApiError both expose the response code as `code`, not `onlineCode`.
  for (const [failure, unavailable] of [
    [{status: 503, code: 'attachment_list_unavailable'}, true],
    [{status: 503, code: 'voice_unavailable'}, false],
    [{status: 503, code: 'file_unavailable'}, false],
    [{status: 500, code: 'attachment_list_unavailable'}, false],
  ]) {
    const h = reader(); h.requests[0].resolve(page([item('file-a')], 'cursor-a')); await h.settle();
    h.refresh(); h.requests[1].reject(failure); await h.settle();
    assert.equal(h.value().state, unavailable ? 'unavailable' : 'error');
    assert.deepEqual(h.value().items.map(value => value.id), unavailable ? [] : ['file-a']);
    assert.equal(h.value().cursor, unavailable ? null : 'cursor-a');
    assert.equal(h.value().depth, unavailable ? 0 : 1);
    assert.match(h.value().message, unavailable ? /未接通/ : /較早讀取/);
    assert.deepEqual(h.errors, []); h.unmount();
  }
});

test('revoked access removes loaded metadata and calls the existing authority owner', async () => {
  const h = reader(); h.requests[0].resolve(page([item('file-a')], 'cursor-a')); await h.settle();
  h.value().loadMore(); const denied = {status: 403, code: 'access_denied'}; h.requests[1].reject(denied); await h.settle();
  assert.equal(h.value().items.length, 0); assert.deepEqual(h.errors, [denied]); h.unmount();
});

test('quiet invalidation preserves the loaded depth and old snapshot until fresh-cursor pages all succeed', async () => {
  const h = reader(); h.requests[0].resolve(page([item('file-a')], 'old-cursor-a')); await h.settle();
  h.value().loadMore(); h.requests[1].resolve(page([item('file-b')], 'old-cursor-b')); await h.settle();
  assert.equal(h.value().depth, 2); h.refresh();
  assert.equal(h.value().refreshing, true); assert.equal(h.value().state, 'ready'); assert.equal(h.value().cursor, 'old-cursor-b');
  assert.deepEqual(h.value().items.map(value => value.id), ['file-a', 'file-b']);
  h.value().loadMore(); assert.equal(h.calls.length, 3, 'More must not reenter a cursor during quiet refresh');
  h.requests[2].resolve(page([item('fresh-a')], 'fresh-cursor-a')); await h.settle();
  assert.deepEqual(h.calls[3].query, {cursor: 'fresh-cursor-a'}); assert.equal(h.value().items[0].id, 'file-a');
  h.requests[3].resolve(page([item('fresh-b')], 'fresh-cursor-b')); await h.settle();
  assert.deepEqual(h.value().items.map(value => value.id), ['fresh-a', 'fresh-b']); assert.equal(h.value().cursor, 'fresh-cursor-b'); assert.equal(h.value().depth, 2); h.unmount();
});

test('a quiet second-page failure retains the prior depth and original cursor rather than a partial replacement', async () => {
  const h = reader(); h.requests[0].resolve(page([item('file-a')], 'old-a')); await h.settle();
  h.value().loadMore(); h.requests[1].resolve(page([item('file-b')], 'old-b')); await h.settle();
  h.refresh(); h.requests[2].resolve(page([item('fresh-a')], 'fresh-a')); await h.settle();
  h.requests[3].reject({status: 0, code: 'network_unknown'}); await h.settle();
  assert.equal(h.value().state, 'error'); assert.equal(h.value().depth, 2); assert.equal(h.value().cursor, 'old-b');
  assert.deepEqual(h.value().items.map(value => value.id), ['file-a', 'file-b']); h.unmount();
});

test('multiple invalidations while busy coalesce to one queued read of the loaded depth', async () => {
  const h = reader(); h.requests[0].resolve(page([item('file-a')], 'cursor-a')); await h.settle();
  h.value().loadMore(); h.refresh(); h.refresh(); h.refresh(); assert.equal(h.calls.length, 2);
  h.requests[1].resolve(page([item('file-b')], 'cursor-b')); await h.settle(); assert.equal(h.calls.length, 3);
  h.requests[2].resolve(page([item('file-a')], 'new-a')); await h.settle();
  h.requests[3].resolve(page([item('file-b')], 'new-b')); await h.settle(); assert.equal(h.calls.length, 4); assert.equal(h.value().busy, false); h.unmount();
});

function gallery(platform = 'android') {
  const calls = [], disposed = [], opened = [];
  const h = harness({
    'react-native': {View: 'View', Image: 'Image', Platform: {OS: platform}, StyleSheet: {create: value => value}},
    '../../theme': {colors: {}, spacing: {}, radius: {}, readingType: {}},
    '../AppIcon': {AppIcon: 'AppIcon'}, '../AppStatusBadge': {AppStatusBadge: 'AppStatusBadge'}, '../ReadStateNotice': {ReadStateNotice: 'ReadStateNotice'},
    '../FormDialog': {FormDialog: 'FormDialog'},
    '../history/HistoryCards': {HistoryEntryCard: 'HistoryEntryCard'}, '../ui': {AppButton: 'AppButton', SectionHeader: 'SectionHeader'},
    '../../motion': {MotionList: ({items, renderItem}) => items.map(value => h.jsx('Row', {children: renderItem(value, {exiting: false})}, value.id))},
  });
  const {PhotoGallery, OriginalMediaLibrary} = h.load('src/components/photos/AttachmentLibrary.tsx');
  const props = {items: Array.from({length: 9}, (_, i) => ({...item(`photo-${i}`), mimeType: 'image/png', visibility: 'private', createdAtLabel: 'Synthetic date', imageSource: null})), scopeKey: 'synthetic-a', disabled: false, rowRef() {}, openPhoto: value => opened.push(value.id),
    readThumbnail: async (value, signal) => {calls.push({id: value.id, signal}); return {uri: `synthetic:${value.id}`, dispose: () => disposed.push(value.id)};}};
  return {...h, calls, disposed, opened, props, PhotoGallery, OriginalMediaLibrary, renderGallery: () => h.render(h.jsx(PhotoGallery, props)), settle: async () => {await Promise.resolve(); h.render();}};
}

test('the photo gallery reads only four mounted originals, opens the entire card and releases URLs on paging', async () => {
  const h = gallery(); h.renderGallery(); await h.settle(); assert.equal(h.calls.length, 4);
  assert.equal(h.node('photo-item-photo-0').props.preserveFocusWhenDisabled, true);
  h.node('photo-item-photo-0').props.onPress(); assert.deepEqual(h.opened, ['photo-0']);
  h.hosts().find(node => node.type === 'AppButton' && node.props.label === '下一組照片').props.onPress(); h.render(); await h.settle();
  assert.equal(h.calls.length, 8); assert.deepEqual(h.disposed.sort(), ['photo-0', 'photo-1', 'photo-2', 'photo-3']);
  assert.ok(h.calls.slice(0, 4).every(value => value.signal.aborted)); h.unmount(); assert.equal(h.disposed.length, 8);
});

test('media pages retain continuation for empty scans and distinguish unavailable endpoints from empty lists', () => {
  const h = gallery(); const next = () => {}, props = {kind: 'file', page: {items: [], state: 'ready', hasMore: true, online: true, busy: false, refresh() {}, loadMore: next}};
  h.render(h.jsx(h.OriginalMediaLibrary, props)); assert.equal(h.hosts().find(node => node.type === 'ReadStateNotice').props.state, 'ready');
  assert.equal(h.hosts().find(node => node.type === 'AppButton' && node.props.label === '載入更多影片與文件').props.onPress, next);
  h.render(h.jsx(h.OriginalMediaLibrary, {kind: 'voice'})); assert.equal(h.hosts().find(node => node.type === 'ReadStateNotice').props.state, 'unavailable'); h.unmount();
});

test('ready media has no permanent refresh action and quiet refresh keeps the More label enabled and stable', () => {
  const h = gallery(), base = {items: [], state: 'ready', hasMore: true, online: true, busy: true, refreshing: true, refresh() {}, loadMore() {}};
  h.render(h.jsx(h.OriginalMediaLibrary, {kind: 'file', page: base}));
  assert.equal(h.hosts().some(node => node.type === 'AppButton' && node.props.label === '重新讀取影片與文件'), false);
  const more = h.hosts().find(node => node.type === 'AppButton' && node.props.label === '載入更多影片與文件');
  assert.equal(more.props.disabled, false); assert.equal(more.props.loading, false);
  h.render(h.jsx(h.OriginalMediaLibrary, {kind: 'file', page: {...base, online: false, busy: false, refreshing: false}}));
  const retry = h.hosts().find(node => node.type === 'AppButton' && node.props.label === '重新讀取影片與文件');
  assert.equal(retry.props.disabled, true); h.unmount();
});

test('web thumbnails wait until their bounded cards approach the viewport and cancel late results on leave', async () => {
  const original = globalThis.IntersectionObserver, observers = [];
  globalThis.IntersectionObserver = class {constructor(callback) {this.callback = callback; observers.push(this);} observe() {} disconnect() {}};
  try {
    const h = gallery('web'); h.renderGallery(); assert.equal(h.calls.length, 0); assert.equal(observers.length, 4);
    observers[0].callback([{isIntersecting: true}]); assert.equal(h.calls.length, 1);
    h.unmount(); await Promise.resolve(); assert.equal(h.calls[0].signal.aborted, true); assert.deepEqual(h.disposed, ['photo-0']);
  } finally { if (original === undefined) delete globalThis.IntersectionObserver; else globalThis.IntersectionObserver = original; }
});

function thumbnailOwner() {
  // Evaluate the exact owner callback, not a copied implementation or a mock read owner.
  const source = readFileSync(new URL('../src/production/PhotoInputDomains.tsx', import.meta.url), 'utf8');
  const file = ts.createSourceFile('PhotoInputDomains.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let callback;
  const find = node => {if (ts.isPropertyAssignment(node) && node.name.getText(file) === 'readThumbnail') callback = node.initializer.getText(file); ts.forEachChild(node, find);}; find(file); assert.ok(callback);
  const code = ts.transpileModule(`export const readThumbnail = ${callback};`, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  let scope = 'synthetic-a'; const counts = {photo: 0, content: 0, bytes: 0, preview: 0, disposed: 0}, errors = [];
  const input = {...item('photo-a'), mimeType: 'image/png'}, signal = new AbortController();
  const envRef = {current: {scopeKey: scope, userId: 'synthetic-user', childId: 'synthetic-child'}};
  const api = {photo: async () => {counts.photo++; return input;}, content: async () => {counts.content++; return 'synthetic-blob';}};
  class PhotoApiError extends Error {constructor(status) {super('Synthetic failure'); this.status = status;}}
  const exports = {};
  new Function('exports', 'envRef', 'current', 'available', 'api', 'readBlobBytes', 'photoPreview', 'PhotoApiError', 'resetAccess', code)(exports, envRef, () => scope === envRef.current.scopeKey, () => true, api,
    async () => {counts.bytes++; return new Uint8Array([1]);}, () => {counts.preview++; return {uri: 'synthetic:photo', dispose() {counts.disposed++;}};}, PhotoApiError, error => errors.push(error));
  return {read: () => exports.readThumbnail(input, signal.signal), input, api, signal, counts, errors, PhotoApiError, switchScope: () => {scope = 'synthetic-b';}};
}

test('the original photo owner checks scope and immutable identity before reading thumbnail bytes', async () => {
  const wrongChild = thumbnailOwner(); wrongChild.input.childId = 'other-child'; assert.equal(await wrongChild.read(), null); assert.equal(wrongChild.counts.photo, 0);
  const changed = thumbnailOwner(); changed.api.photo = async () => ({...changed.input, version: 2}); assert.equal(await changed.read(), null); assert.equal(changed.counts.content, 0);
  const late = thumbnailOwner(); late.api.content = async () => {late.switchScope(); return 'old-scope-blob';}; assert.equal(await late.read(), null); assert.equal(late.counts.bytes, 0); assert.equal(late.counts.preview, 0);
});

test('thumbnail authorization failure delegates to the original photo owner and successful URLs remain disposable', async () => {
  const revoked = thumbnailOwner(); revoked.api.photo = async () => {throw new revoked.PhotoApiError(403);}; assert.equal(await revoked.read(), null); assert.equal(revoked.errors.length, 1);
  const success = thumbnailOwner(); const preview = await success.read(); assert.equal(preview.uri, 'synthetic:photo'); assert.deepEqual(success.counts, {photo: 1, content: 1, bytes: 1, preview: 1, disposed: 0}); preview.dispose(); assert.equal(success.counts.disposed, 1);
});
