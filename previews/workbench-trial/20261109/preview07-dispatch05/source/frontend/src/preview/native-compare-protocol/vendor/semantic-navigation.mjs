/** Pure entry-intent translation, not a router, source attestation or runtime gate.
 * Only these frozen source identities have the route semantics declared below.
 * A mapped route never implies owner acceptance, URL acknowledgement or a frame.
 */
import {record, validateRegistry, VARIANTS} from './registry.mjs';

const FOUR_RECEIPT = '907ec9573cfb6213a30a019363fcb56b82441be5ee01706700d169e44997fc9a';
const SUPPORTED_SOURCE_PINS = {
  original: {
    source: {kind: 'composite', appCommit: null, sourceTree: 'de0cbacb583c923fba8f88f27fd5f6b8d5409c1c', recipeSha256: 'e49b453d98d3bcb34ea51bb67d068078d90e9c50c8862ae70b81f3bbe237074b'},
    receiptSha256: '979f1911d6132bf3bb2e08d62483619b67ada7f5ef6fb769ebe8ec6448f5bba1',
  },
  harbour: {
    source: {kind: 'git-commit', appCommit: '4050c0a16d0a9735923434abc9749ecd416d7926', sourceTree: 'fcc2393ea5f6bf6963fbf9b281f24bd02de76ea2'},
    receiptSha256: FOUR_RECEIPT,
  },
  care: {
    source: {kind: 'git-commit', appCommit: '520d4c88a74faf460a464c38931cd9e1a84e0ec8', sourceTree: 'c0abef888f7bf10054a0b7b07cfc85b78b259073'},
    receiptSha256: FOUR_RECEIPT,
  },
  handbook: {
    source: {kind: 'git-commit', appCommit: '72a00c860118e254e05249b471efb2a676aaaa42', sourceTree: '8af71f2826cec47d5625053b68b87aba2ab52722'},
    receiptSha256: FOUR_RECEIPT,
  },
  fourth: {
    source: {kind: 'git-commit', appCommit: '76493c5e0747cb5da908fdb708879fd96509d093', sourceTree: 'bf3ea11faf2bc58f664518c79575686ebb2bba84'},
    receiptSha256: FOUR_RECEIPT,
  },
};
// Metadata only: this is the existing Tasks case, not a whole-site fixture.
const FIXTURE_IDENTITY = {
  documentSha256: 'd108aca1f8248e76e28ce4ab5c3497005cff5f1e6f15f2d23081b8d32bd2d5e4',
  childId: 'preview-child-01', asOf: '2026-10-04T16:00:00+08:00', timeZone: 'Asia/Hong_Kong',
};
const TASK_IDS = new Set(['ordinary', 'appointment', 'review', 'future', 'completed', 'cancelled']
  .map(suffix => `preview-child-01-task-${suffix}`));
const TASK_FIELDS = ['tab', 'filter', 'page', 'day', 'month', 'taskId'];
const PAGE_FIELDS = {
  home: [], chat: [], tasks: TASK_FIELDS, growth: ['tab'], care: ['section'], summary: ['tab'],
  history: ['category'], profile: [], memory: [], photos: [], sources: [], family: [], contact: [],
  settings: ['section'], guide: [], more: [], login: [], admin: [],
};
const HISTORY_CATEGORIES = ['tasks', 'preparations', 'review', 'care', 'profile', 'conversations', 'growth', 'notifications'];
const SETTINGS_SECTIONS = ['account', 'children', 'family', 'preferences', 'notifications', 'model', 'assistant', 'privacy'];
const PAGE_GATES = {
  family: 'FAMILY_COLLABORATION_UNAVAILABLE',
  login: 'SIGNED_OUT_FIXTURE_NOT_BOUND',
  admin: 'ADMIN_ACCESS_FIXTURE_NOT_BOUND',
};
const capabilities = () => ({runtimeReady: false, navigable: false, functional: false, browserVerified: false, selectable: false});
const unavailable = reason => ({status: 'unavailable', reason, targets: null, capabilities: capabilities()});
const unavailableTranslation = (reason, fields = []) => ({status: 'unavailable', reason, fields});

function requestShape(request) {
  try {
    record(request, ['semanticPage', 'pageState', 'scenario', 'fixtureIdentity']);
    record(request.fixtureIdentity, ['documentSha256', 'childId', 'asOf', 'timeZone']);
    const fields = Reflect.ownKeys(request.pageState);
    if (fields.some(key => typeof key !== 'string')) throw new Error();
    record(request.pageState, fields);
    return fields;
  } catch {
    throw new Error('INVALID_NAVIGATION_REQUEST');
  }
}
function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function validMonth(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value) && validDay(`${value}-01`);
}
function validValue(page, field, value) {
  if (page === 'tasks') {
    if (field === 'taskId') return TASK_IDS.has(value);
    if (field === 'tab') return ['pending', 'completed'].includes(value);
    if (field === 'filter') return ['near', 'earlier', 'later', 'all', 'review', 'unconfirmed'].includes(value);
    if (field === 'page') return Number.isSafeInteger(value) && value >= 0 && value <= 100000;
    if (field === 'day') return value === null || validDay(value);
    if (field === 'month') return value === null || validMonth(value);
  }
  if (page === 'growth') return ['concerns', 'preparation'].includes(value);
  if (page === 'summary') return ['overview', 'archive'].includes(value);
  if (page === 'care') return ['review', 'records'].includes(value);
  if (page === 'history') return HISTORY_CATEGORIES.includes(value);
  if (page === 'settings') return SETTINGS_SECTIONS.includes(value);
  return false;
}
function availability(page) {
  const reasons = ['SOURCEFRAME_NOT_AVAILABLE'];
  if (page !== 'tasks') reasons.push('SHARED_PAGE_FIXTURE_NOT_BOUND');
  if (Object.hasOwn(PAGE_GATES, page)) reasons.push(PAGE_GATES[page]);
  return {status: 'unavailable', reasons};
}
function translate(variant, page, state) {
  // Reject the entire intent rather than dropping an unsupported field or relying
  // on a source's local default state. Even explicitly requested defaults count.
  let unsupported = [];
  if (page === 'tasks' && ['original', 'fourth'].includes(variant)) {
    unsupported = TASK_FIELDS.filter(key => key !== 'taskId' && Object.hasOwn(state, key));
  } else if (page === 'care' && !['care', 'handbook'].includes(variant) && Object.hasOwn(state, 'section')) {
    unsupported = ['section'];
  }
  if (unsupported.length) return unavailableTranslation('PAGE_STATE_NOT_ROUTE_ADDRESSABLE', unsupported);
  const params = {};
  for (const key of PAGE_FIELDS[page]) {
    if (!Object.hasOwn(state, key) || state[key] === null) continue;
    if (page === 'care') params.tab = variant === 'care' ? state.section : state.section === 'review' ? 'pending' : 'recorded';
    else params[key] = String(state[key]);
  }
  return {status: 'mapped', pathname: page === 'home' ? '/' : `/${page}`, params};
}

export function planSemanticNavigation(registry, request) {
  const fields = requestShape(request);
  validateRegistry(registry);
  const page = request.semanticPage, state = request.pageState;
  if (typeof page !== 'string' || !Object.hasOwn(PAGE_FIELDS, page)) throw new Error('UNKNOWN_SEMANTIC_PAGE');
  if (fields.some(key => !PAGE_FIELDS[page].includes(key))) throw new Error('UNKNOWN_PAGE_STATE_FIELD');
  if (fields.some(key => !validValue(page, key, state[key]))) throw new Error('INVALID_PAGE_STATE');
  if (request.scenario !== 'normal') return unavailable('SCENARIO_NOT_MAPPED');
  if (Object.keys(FIXTURE_IDENTITY).some(key => request.fixtureIdentity[key] !== FIXTURE_IDENTITY[key])) {
    return unavailable('FIXTURE_IDENTITY_MISMATCH');
  }
  const targets = {};
  for (const variant of VARIANTS) {
    const row = registry.sources[variant], expected = SUPPORTED_SOURCE_PINS[variant];
    let source = null, translation;
    if (row.status !== 'source-verified') translation = unavailableTranslation('SOURCE_NOT_VERIFIED');
    else {
      // Registry validation has already rejected accessors and unknown fields.
      // Copy the full SourcePin contract, including non-enumerable own data.
      source = {kind: row.source.kind, appCommit: row.source.appCommit, sourceTree: row.source.sourceTree};
      if (source.kind === 'composite') source.recipeSha256 = row.source.recipeSha256;
      const same = Object.keys(source).length === Object.keys(expected.source).length &&
        Object.keys(expected.source).every(key => source[key] === expected.source[key]) && row.receiptSha256 === expected.receiptSha256;
      translation = same ? translate(variant, page, state) : unavailableTranslation('STALE_SOURCE_BINDING');
    }
    targets[variant] = {source, translation, availability: availability(page)};
  }
  return {
    status: 'source-plan', semanticPage: page,
    pageState: Object.fromEntries(fields.map(key => [key, state[key]])),
    scenario: 'normal', fixtureIdentity: {...FIXTURE_IDENTITY},
    allVariantsTranslated: VARIANTS.every(variant => targets[variant].translation.status === 'mapped'),
    targets, capabilities: capabilities(),
  };
}
