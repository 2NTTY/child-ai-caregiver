/** Closed synthetic READ seam only. Never installs a global transport or grants readiness. */
import extensionDocument from '../fixtures/normal-tasks-synthetic-bootstrap-v1.json' with {type:'json'};
import pinsDocument from '../sources/normal-read-bootstrap-pins.json' with {type:'json'};
import {normalTasksReadBinding} from './normal-tasks-read-binding.mjs';
export const bootstrapPins = Object.freeze({...pinsDocument});
const copy = value => structuredClone(value);
// Use the platform getter's brand/internal-state check, never caller-owned signal.aborted.
// This bounded seam assumes untampered platform intrinsics; it is not a hostile-global sandbox.
const abortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const applyIntrinsic = Reflect.apply;
function signalAborted(signal) {
  try { return applyIntrinsic(abortedGetter, signal, []); }
  catch { refuse('SIGNAL_REQUIRED'); }
}
const C = 'c0b00000-0000-4000-8000-000000000001';
const W = 'c0b00000-0000-4000-8000-000000000012';
const E = 'c0b00000-0000-4000-8000-000000000013';
const U = 'preview-owner';
const child = `/children/${C}`;
const unbound = new Set([
  `${child}/messages`, '/ai/status', '/ai/usage', `${child}/memory/facts`, `${child}/memory/topics`,
  `${child}/memory/summary`, `${child}/growth`, `${child}/concerns`, `${child}/agent/work`,
  `${child}/library`, `${child}/photos`, `${child}/inputs`, '/ai/settings', '/web-push',
  '/telegram', '/notification-preferences', `${child}/contact`,
]);
const unavailableCodes = new Map([
  ['/account/messages', 'message_history_unavailable'], ['/me/avatar', 'avatar_unavailable'],
  [`${child}/avatar`, 'avatar_unavailable'],
]);
function refuse(code) { throw new Error(`NORMAL_READ_BOOTSTRAP_${code}`); }
function plainData(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) refuse('REQUEST_SHAPE');
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== 'string')) refuse('REQUEST_SHAPE');
  // Snapshot every own data property, including non-enumerable ones. Never evaluate an accessor.
  const snapshot = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, 'value')) refuse('REQUEST_ACCESSOR');
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}
function calendarDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function queryEquals(params, expected) {
  return params.size === Object.keys(expected).length && Object.entries(expected).every(([key, value]) => params.get(key) === value);
}
function requestShape(input, init, origin) {
  init = plainData(init);
  if (Object.keys(init).some(k => !['method', 'credentials', 'cache', 'headers', 'signal', 'body'].includes(k))) refuse('REQUEST_OPTION');
  if (init.credentials !== 'include' || init.cache !== 'no-store') refuse('REQUEST_POLICY');
  signalAborted(init.signal); // authentic brand check; instanceof can be prototype-spoofed
  const method = init.method === undefined ? 'GET' : init.method;
  if (method !== 'GET' && method !== 'POST') refuse('METHOD');
  if (typeof input !== 'string' || !input.startsWith(`${origin}/api/`) || /[\s\\#]/u.test(input) || input.endsWith('?')) refuse('URL');
  const url = new URL(input);
  // Check raw spelling before URL normalization could erase a path traversal, port, userinfo or query alias.
  if (url.origin !== origin || url.href !== input || url.username || url.password || url.pathname.includes('%') || url.pathname.includes('//')) refuse('URL_ALIAS');
  const path = url.pathname.slice(4);
  const params = url.searchParams;
  if (new Set(params.keys()).size !== params.size) refuse('DUPLICATE_QUERY');
  if (url.search && `?${params.toString()}` !== url.search) refuse('QUERY_ALIAS');
  const requestHeaders = plainData(init.headers);
  const headers = new Map();
  for (const [key, value] of Object.entries(requestHeaders)) {
    const name = key.toLowerCase();
    if (headers.has(name) || !['accept', 'content-type', 'x-expected-user-id'].includes(name) || typeof value !== 'string') refuse('HEADER');
    headers.set(name, value);
  }
  if (headers.get('accept') !== 'application/json') refuse('ACCEPT');
  if (headers.has('x-expected-user-id') && headers.get('x-expected-user-id') !== U) refuse('IDENTITY');
  if (method === 'GET') {
    if (Object.hasOwn(init, 'body') || headers.has('content-type')) refuse('GET_BODY');
  } else if (path !== `${child}/care/search` || params.size || init.body !== '{"query":""}' || headers.get('content-type') !== 'application/json' || headers.get('x-expected-user-id') !== U) refuse('POST_NOT_READ');
  if (path.startsWith('/online/') && headers.get('x-expected-user-id') !== U) refuse('IDENTITY_REQUIRED');
  return {method, path, params, signal: init.signal};
}

/** Caller supplies exact admitted artifact pins; package verification seals their physical bytes separately. */
export function createNormalTasksReadBootstrap({registry, variant, scenario = 'normal', origin, fixtureSha256, extensionSha256}) {
  if (origin !== bootstrapPins.origin || fixtureSha256 !== bootstrapPins.fixtureSha256 || extensionSha256 !== bootstrapPins.extensionSha256) refuse('PIN_MISMATCH');
  const binding = normalTasksReadBinding(registry, variant, scenario);
  if (binding.status !== 'native-read-data-projected' || binding.fixtureDocumentSha256 !== fixtureSha256) refuse('SOURCE_OR_SCENARIO');
  const extension = copy(extensionDocument);
  const native = binding.native;
  const responses = new Map([
    ['/auth/get-session', extension.session], ['/account', extension.account], ['/children', extension.children],
    [`${child}/profile`, extension.profile], [`${child}/tasks`, native.page], ['/online/spaces', extension.spaces],
  ]);
  for (const task of native.page.items) {
    responses.set(`${child}/tasks/${task.id}`, {task});
    responses.set(`${child}/tasks/${task.id}/history`, native.histories[task.id]);
  }
  let disposed = false;
  const records = [];
  function active(signal) {
    if (signalAborted(signal)) throw new DOMException('Synthetic read aborted', 'AbortError');
    if (disposed) refuse('DISPOSED');
  }
  async function fetcher(input, init) {
    // Diagnostics intentionally omit bodies, headers and unknown URLs; there is never a fallback fetch.
    const record = {sequence: records.length + 1, outcome: 'pending', route: null};
    records.push(record);
    try {
      const {method, path, params, signal} = requestShape(input, init, origin);
      active(signal);
      let status = 200, payload;
      if (method === 'POST') { status = 503; payload = {error: {code: 'preview_domain_unbound'}}; }
      else if (path === '/online/changes' && queryEquals(params, {workspaceId: W, storageEpoch: E, cursor: '0'})) payload = extension.changes;
      else if (path === `${child}/documents` && queryEquals(params, {status: 'active', limit: '20'})) { status = 503; payload = {error: {code: 'preview_domain_unbound'}}; }
      else if (path === `${child}/summary` && calendarDay(params.get('startDay') ?? '') && queryEquals(params, {startDay: params.get('startDay'), period: 'week', timeZone: 'Asia/Hong_Kong'})) { status = 503; payload = {error: {code: 'preview_domain_unbound'}}; }
      else if (params.size) refuse('QUERY_NOT_BOUND');
      else if (responses.has(path)) payload = responses.get(path);
      else if (unbound.has(path) || unavailableCodes.has(path)) { status = 503; payload = {error: {code: unavailableCodes.get(path) ?? 'preview_domain_unbound'}}; }
      else refuse('ROUTE_NOT_BOUND');
      // Yield once so same-turn cancellation/disposal cannot publish a late synthetic response.
      await Promise.resolve();
      active(signal);
      const response = new Response(JSON.stringify(payload), {status, headers: {'Content-Type': 'application/json'}});
      // Native callers parse asynchronously; cancellation between headers and body must also refuse publication.
      const json = response.json.bind(response);
      response.json = async () => { active(signal); const value = await json(); active(signal); return value; };
      record.outcome = status === 200 ? 'success' : 'unavailable';
      record.route = `${method} ${path}`;
      record.status = status;
      return response;
    } catch (error) {
      record.outcome = error?.name === 'AbortError' ? 'aborted' : 'rejected';
      throw error;
    }
  }
  return {
    name: extension.name, variant, scenario, runtimeReady: false, frameReady: false, selectable: false, mutationReady: false, dataMapped: false,
    get extension() { return copy(extension); }, fetcher,
    diagnostics: () => copy(records),
    dispose() { disposed = true; },
  };
}
