import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ts from 'typescript';

// Uses the real provider, environment hook and task-domain bridge with synthetic
// stores and data hooks. Counts React renders/publications, not browser FPS.
// An existing external jsdom may be supplied without adding a product dependency.
const require = createRequire(import.meta.url);
const { JSDOM } = require(process.env.TEST_JSDOM_PATH || 'jsdom');
const rootPath = path.resolve(import.meta.dirname, '..');
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://synthetic.invalid/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const transparent = ({ children }) => children;
const dialog = Object.assign(() => null, { Title: transparent, Content: transparent, Actions: transparent });

function setup() {
  const route = React.createContext('/');
  const counts = { bridge: 0, summary: 0 };
  const guards = new Map();
  const instances = [];
  const environments = [];
  let setPending, visibleSummary;
  const store = value => ({ getSnapshot: () => value, subscribe: () => () => {} });
  const children = ['a', 'b'].map(id => ({ id, displayName: `Synthetic ${id}`, accessRole: 'owner' }));
  const snapshot = (userId = 'parent-a', childId = 'a', generation = 1) => ({
    identityKey: userId ? `${userId}:${generation}` : null,
    scopeKey: userId && childId ? `${userId}:${generation}:${childId}` : null,
    sessionGeneration: generation, homeIntroductionPending: false,
    records: { user: userId ? { id: userId } : null, auth: userId ? 'signedIn' : 'signedOut', online: true,
      selectedChildId: childId, children: userId ? children : [], drafts: {}, busy: null, childOutcome: 'draft', deletion: null, notice: null },
    chat: { selectedChildId: childId, drafts: {}, messages: [], busy: null },
    account: { gate: userId ? 'ready' : 'checking', busy: null },
  });
  class Owner {
    value = snapshot();
    listeners = new Set();
    pending = new Set();
    apiBaseUrl = '/api';
    queryClient = {};
    draftOwner = { ...store({ scope: this.value.scopeKey, attachments: [] }), clearAttachments() {} };
    agentOwner = { ...store({ model: { busy: false, pendingDecision: false }, inbox: {}, runs: {}, pending: {} }) };
    authorizationOwner = store({ busy: false, pending: null });
    accountOwner = {};
    chatController = { hasUnsavedInput: () => false, getSnapshot: () => this.value.chat };
    controller = { getSnapshot: () => this.value.records, restoreSession: async () => {}, cancelDeleteChild() {}, cancelLogout() {} };
    constructor() { instances.push(this); }
    getSnapshot = () => this.value;
    subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
    emit = () => { this.value = { ...this.value }; this.listeners.forEach(listener => listener()); };
    setIdentity = (userId, childId, generation) => { this.value = snapshot(userId, childId, generation); this.emit(); };
    setDomainPending = (id, value) => { if (this.pending.has(id) === value) return; value ? this.pending.add(id) : this.pending.delete(id); this.emit(); };
    hasDomainPending = () => this.pending.size !== 0;
    canStartDomainWrite = () => !this.hasDomainPending();
    invalidatePrivateReads = () => {};
    handleDomainAccessError = () => {};
    markHomeIntroductionPresented = () => {};
    connect() {}
    dispose() { this.listeners.clear(); this.disposed = true; }
  }
  const cache = new Map();
  const router = { push() {} }, leave = action => action();
  function compile(relative) {
    const filename = path.resolve(rootPath, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const output = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    new Function('require', 'module', 'exports', output)(name => {
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      if (name === 'react-native') return { Platform: { OS: 'web' }, Linking: {} };
      if (name === 'react-native-paper') return { Text: transparent };
      if (name === 'expo-router') return { usePathname: () => React.useContext(route), useRouter: () => router };
      if (name === '@tanstack/react-query') return { QueryClientProvider: transparent };
      if (name.endsWith('/AppDialog')) return { AppDialog: dialog };
      if (name.endsWith('/components/ui')) return { AppButton: () => null };
      if (name.endsWith('/AccountCallbackGate')) return { AccountCallbackGate: transparent };
      if (name.endsWith('/PreviewNavigationGuard')) return {
        usePreviewNavigation: () => leave,
        usePreviewLeaveGuard: (dirty, pending, scope) => {
          const id = React.useId();
          React.useLayoutEffect(() => { guards.set(id, { dirty, pending, scope }); return () => guards.delete(id); }, [id, dirty, pending, scope]);
          return id;
        },
      };
      if (name.endsWith('/assistant-draft')) return { emptyAssistantDraft: { attachments: [] }, photoAttachment: value => value };
      if (name === './ProductionOwner') return { ProductionOwner: Owner };
      if (name === './home-projection') return { projectProductionHome: value => ({ selectedChildId: value.records.selectedChildId, children: value.records.children }) };
      if (name === './routes') return { productionDestinations: {} };
      if (name.endsWith('/use-online-updates')) return { useOnlineUpdates() {} };
      if (name === './ProductionProvider') return compile('src/production/ProductionProvider.tsx');
      if (name === './useDomainEnvironment') return compile('src/production/useDomainEnvironment.ts');
      if (name === './task-knowledge-tasks') return { useTaskKnowledgeTasks: env => {
        counts.bridge++;
        if (environments.at(-1) !== env) environments.push(env);
        const [pending, update] = React.useState(false); setPending = update;
        compile('src/production/useDomainEnvironment.ts').useDomainWriteGuard(false, pending);
        return { scopeKey: env.scopeKey, model: { pending } };
      } };
      if (name === './task-knowledge-summary') return { useTaskKnowledgeSummary: env => ({ model: { scopeKey: env.scopeKey, childId: env.childId } }) };
      if (name === './task-knowledge-memory') return { useTaskKnowledgeMemory: () => ({ value: {} }) };
      if (name === './task-knowledge-growth') return { useTaskKnowledgeGrowth: () => ({ model: { page: null }, actions: {} }) };
      if (name === './useFamilyDocuments') return { useFamilyDocuments: () => ({ archive: {}, preparation: {} }) };
      if (name === './usePersonalHistory') return { usePersonalHistory: () => ({}), PersonalHistoryProvider: transparent };
      if (/\/workspaces\//.test(name)) return new Proxy({}, { get: () => transparent });
      assert.fail(`Unexpected source import: ${name}`);
    }, module, module.exports);
    return module.exports;
  }
  const provider = compile('src/production/ProductionProvider.tsx');
  const domains = compile('src/production/TaskKnowledgeDomains.tsx');
  function Consumer() {
    visibleSummary = domains.useProductionTaskKnowledgeSummary();
    React.useLayoutEffect(() => { counts.summary++; }, [visibleSummary]);
    return null;
  }
  const app = React.createElement(provider.ProductionProvider, null,
    React.createElement(domains.ProductionTaskKnowledgeDomains, null, React.createElement(Consumer)));
  const root = createRoot(document.getElementById('root'));
  const navigate = async pathname => { await act(async () => { root.render(React.createElement(route.Provider, { value: pathname }, app)); }); };
  return { counts, guards, navigate, instances, environments, pending: value => act(async () => { setPending(value); }),
    identity: (user, child, generation) => act(async () => { instances[0].setIdentity(user, child, generation); }),
    summary: () => visibleSummary,
    close: () => act(async () => { root.unmount(); }) };
}

test('ordinary route changes do not wake or republish an unrelated mounted domain bridge', async t => {
  const h = setup();
  try {
    await h.navigate('/');
    const baseline = { ...h.counts };
    for (const route of ['/tasks', '/growth', '/care', '/']) await h.navigate(route);
    t.diagnostic(JSON.stringify({ routeChanges: 4, before: baseline, after: h.counts }));
    assert.deepEqual(h.counts, baseline, 'unchanged business scope must not fan route updates into the data bridge');
    assert.equal(h.instances.length, 1);
    assert.equal(h.summary().model.scopeKey, 'parent-a:1:a');
  } finally { await h.close(); }
});

test('pending guards survive navigation while child, identity and logout still clear the old scope', async () => {
  const h = setup();
  try {
    await h.navigate('/');
    const firstEnvironment = h.environments.at(-1);
    await h.pending(true);
    assert.equal(h.instances[0].hasDomainPending(), true);
    assert.ok([...h.guards.values()].some(value => value.pending));
    await h.navigate('/tasks');
    assert.equal(h.instances[0].hasDomainPending(), true);
    await h.identity('parent-a', 'b', 1);
    assert.equal(firstEnvironment.current(), false, 'old child callbacks remain invalid');
    assert.equal(firstEnvironment.currentIdentity(), true, 'a child switch does not fabricate a new identity');
    const secondEnvironment = h.environments.at(-1);
    assert.equal(h.summary().model.scopeKey, 'parent-a:1:b');
    assert.equal(h.instances[0].hasDomainPending(), false);
    assert.ok([...h.guards.values()].every(value => !value.pending));
    await h.pending(true);
    await h.identity(null, null, 2);
    assert.equal(firstEnvironment.currentIdentity(), false);
    assert.equal(secondEnvironment.current(), false);
    assert.equal(secondEnvironment.currentIdentity(), false);
    assert.equal(h.summary(), null);
    assert.equal(h.instances[0].hasDomainPending(), false);
    assert.equal(h.guards.size, 0);
    await h.identity('parent-b', 'a', 3);
    assert.equal(firstEnvironment.current(), false);
    assert.equal(firstEnvironment.currentIdentity(), false);
    assert.equal(h.summary().model.scopeKey, 'parent-b:3:a');
    assert.equal(h.instances.length, 1, 'the shared owner retains its existing identity lifecycle');
  } finally { await h.close(); }
  assert.equal(h.instances[0].disposed, true);
});
