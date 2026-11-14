import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { harness } from "./scope-transition-harness.mjs";

const root = path.resolve(import.meta.dirname, "..");

class SyntheticApiError extends Error {
  constructor(status = 500, code = "unknown") {
    super(`Synthetic ${status} ${code}`);
    this.status = status;
    this.code = code;
  }
}

const settle = async () => {
  await new Promise(setImmediate);
  await new Promise(setImmediate);
};

function makeAttention(id, state, updatedAt) {
  return {
    id,
    childId: "child-a",
    topicId: "solid_food",
    version: 1,
    state,
    title: `Attention ${id}`,
    kind: "arrange",
    whyNow: "Synthetic whyNow",
    advice: "Synthetic advice",
    limits: "Synthetic limits",
    basis: { stage: "6-12", ruleRevision: "rev-1", sourceHash: "a".repeat(64), values: {} },
    evidence: { profileVersion: 1, facts: [] },
    source: {
      sourceId: "src-1",
      versionId: "v1",
      chunkId: "c1",
      contentHash: "b".repeat(64),
      url: "https://www.fhs.gov.hk/synthetic",
      title: "Synthetic",
      section: "s1",
      checkedAt: "2026-10-01T00:00:00Z",
      excerpt: "Synthetic",
    },
    sourceAvailable: true,
    createdAt: updatedAt,
    updatedAt,
    snoozeUntil: null,
    previousId: null,
    newReason: "Synthetic",
    taskId: null,
    taskState: null,
    lastAction: state === "dismissed" ? "dismiss" : "created",
    actorUserId: "user-1",
    note: "",
  };
}

function growthFixture(options = {}) {
  const mocks = {};
  const h = harness(mocks);
  const queries = [];
  let active = true;
  let value;
  const historyRequests = [];
  const concernRequests = [];

  const env = {
    apiBaseUrl: "/api",
    userId: "user-1",
    childId: "child-a",
    childName: "Synthetic Child",
    scopeKey: "scope-a",
    role: "owner",
    online: true,
    sharedMode: false,
    allows: () => true,
    current: () => active,
    canStartWrite: () => true,
    invalidate() {},
    accessError() { active = false; },
    owner: { fetcher() { assert.fail("Real network forbidden"); } },
    queryClient: {
      setQueryDefaults() {},
      cancelQueries: async () => {},
      removeQueries() {},
      fetchQuery: ({ queryKey, queryFn }) => {
        queries.push(queryKey);
        return queryFn({ signal: new AbortController().signal });
      },
    },
  };

  mocks["./useDomainEnvironment"] = {
    useDomainEnvironment: () => env,
    useDomainWriteGuard() {},
  };
  mocks["../../../src/client/online-refresh-events"] = {
    subscribeOnlineRefresh: () => () => {},
  };
  mocks["../../../src/client/growth-api"] = {
    GrowthApiError: SyntheticApiError,
    requiresFreshGrowthConfirmation: () => false,
    createGrowthApi: () => ({
      async getPage(_childId, _signal, _userId, opts) {
        historyRequests.push(opts?.historyCursor ?? null);
        return options.getGrowthPage(opts?.historyCursor ?? null);
      },
      async decideAttention() { throw new Error("unexpected"); },
      async updateTopic() { throw new Error("unexpected"); },
    }),
  };
  mocks["../../../src/client/concerns-api"] = {
    ConcernApiError: SyntheticApiError,
    requiresFreshConcernConfirmation: () => false,
    createConcernsApi: () => ({
      async getPage(_childId, _signal, _userId, opts) {
        concernRequests.push(opts?.cursor ?? null);
        return options.getConcernPage(opts?.cursor ?? null);
      },
      async create() { throw new Error("unexpected"); },
      async change() { throw new Error("unexpected"); },
      async update() { throw new Error("unexpected"); },
    }),
  };

  const growthHook = h.load("src/production/task-knowledge-growth.ts");
  function Host() {
    value = growthHook.useTaskKnowledgeGrowth(env);
    return null;
  }

  return {
    h,
    env,
    historyRequests,
    concernRequests,
    get: () => value,
    async start() {
      h.render(h.jsx(Host, {}));
      await settle();
      h.render(h.jsx(Host, {}));
    },
    async act(fn) {
      fn(value.actions, value);
      await settle();
      h.render(h.jsx(Host, {}));
    },
    close() {
      h.unmount();
    },
  };
}

function renderCandidates(model, actions) {
  const mocks = {
    react: undefined,
    "../components/AppCheckbox": { AppCheckbox: "AppCheckbox" },
    "../components/AppDialog": {
      AppDialog: Object.assign(p => ({ type: "AppDialog", props: p }), {
        Title: "DialogTitle",
        ScrollArea: "DialogScroll",
        Actions: "DialogActions",
      }),
    },
    "../components/AppScrollView": { AppScrollView: "AppScrollView" },
    "../components/DateTimeFields": { AppDateTimeField: "AppDateTimeField", AppTimeZoneSelect: "AppTimeZoneSelect" },
    "../components/ui": {
      AppButton: "AppButton",
      AppSelect: "AppSelect",
      AppTextField: "AppTextField",
      SectionCard: "SectionCard",
      SectionHeader: "SectionHeader",
    },
    "../components/summary/SummaryDisclosure": { SummaryDisclosure: "SummaryDisclosure" },
    "../components/FormDialog": { ManualFormDialog: "ManualFormDialog" },
    "../components/growth/GrowthOperationRecovery": { GrowthOperationRecovery: "GrowthOperationRecovery" },
    "../components/growth/growth-styles": { growthStyles: {} },
    "../components/growth/useGrowthFormDraftGuard": { useGrowthFormDraftGuard: () => ({ edited() {}, submitted() {} }) },
    "../preview/PreviewNavigationGuard": { usePreviewNavigation: () => fn => fn() },
    "react-native": { Linking: { openURL: async () => {} }, View: "View" },
    "react-native-paper": { Text: "Text" },
    "react-hook-form": { Controller: "Controller", useForm: () => ({ control: {}, watch: () => ({}), handleSubmit: fn => fn, reset() {} }) },
  };
  const h = harness(mocks);
  mocks.react = { ...h.react };
  const file = path.join(root, "src/production/TaskKnowledgeGrowthCandidates.tsx");
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const mod = { exports: {} };
  const resolvedShared = h.load(path.resolve(root, "../src/shared/growth.ts"));
  const resolvedVm = h.load(path.resolve(root, "src/growth-view-model.ts"));
  new Function("require", "module", "exports", code)(name => {
    if (name in mocks) return mocks[name];
    if (name === "react") return mocks.react;
    if (name === "react/jsx-runtime") return { jsx: h.jsx, jsxs: h.jsx, Fragment: "Fragment" };
    if (name.endsWith("/shared/growth")) return resolvedShared;
    if (name.endsWith("/growth-view-model")) return resolvedVm;
    throw new Error(`Unexpected import: ${name}`);
  }, mod, mod.exports);
  const hosts = h.render(h.jsx(mod.exports.TaskKnowledgeGrowthCandidates, { model, actions, onTask() {} }));
  h.unmount();
  return hosts;
}

test("growth loadMoreHistory and loadMoreConcerns paginate, deduplicate, and enforce authority guards", async () => {
  const p1 = [
    makeAttention("active-1", "proposed", "2026-09-10T00:00:00Z"),
    makeAttention("hist-30", "dismissed", "2026-09-09T00:00:00Z"),
  ];
  const p2 = [
    makeAttention("hist-30", "dismissed", "2026-09-09T00:00:00Z"), // duplicate check
    makeAttention("hist-31", "dismissed", "2026-09-08T00:00:00Z"),
  ];
  let growthCalls = 0;
  let failNextHistory = false;
  let driftAuthority = false;

  const f = growthFixture({
    getGrowthPage: async cursor => {
      growthCalls++;
      if (!cursor) {
        return {
          authorityVersion: "auth-v1",
          items: p1,
          historyHasMore: true,
          historyNextCursor: "cur-history-1",
          topics: [],
          notices: [],
          eligibleAssignees: [],
          canManage: true,
        };
      }
      if (failNextHistory) {
        failNextHistory = false;
        throw new Error("Synthetic network error");
      }
      return {
        authorityVersion: driftAuthority ? "auth-v2" : "auth-v1",
        items: p2,
        historyHasMore: false,
        historyNextCursor: null,
        topics: [],
        notices: [],
        eligibleAssignees: [],
        canManage: true,
      };
    },
    getConcernPage: async cursor => ({
      authorityVersion: driftAuthority ? "auth-v2" : "auth-v1",
      items: cursor
        ? [{ id: "con-2", childId: "child-a", title: "C2", summary: "S2", version: 1, status: "open", createdAt: "2026-09-02T00:00:00Z", updatedAt: "2026-09-02T00:00:00Z", updatedBy: "user-1", taskId: null, taskState: null, followUpAt: null, sourceObservationCount: 1, linkedTaskTitle: null }]
        : [{ id: "con-1", childId: "child-a", title: "C1", summary: "S1", version: 1, status: "open", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", updatedBy: "user-1", taskId: null, taskState: null, followUpAt: null, sourceObservationCount: 1, linkedTaskTitle: null }],
      hasMore: !cursor,
      nextCursor: cursor ? null : "cur-con-1",
      canManage: true,
    }),
  });

  try {
    await f.start();
    assert.equal(f.get().model.page.items.length, 2);
    assert.equal(f.get().model.page.historyHasMore, true);
    assert.equal(f.get().model.page.historyNextCursor, "cur-history-1");

    const hosts1 = renderCandidates(f.get().model, f.get().actions);
    assert.ok(hosts1.some(n => n.type === "Text" && n.props.children === "仍有較早建議未載入。"));
    const loadMoreBtn = hosts1.find(n => n.type === "AppButton" && n.props.label === "載入較早建議");
    assert.ok(loadMoreBtn, "Load more history button must render when cursor & handler are present");

    // Transient failure retains loaded items and records error.
    failNextHistory = true;
    await f.act(a => a.loadMoreHistory());
    assert.equal(f.get().model.page.items.length, 2);
    assert.match(f.get().model.historyLoadError, /未能載入較早成長建議/);

    // Authority drift rejects merging newer-authority history into older page.
    driftAuthority = true;
    await f.act(a => a.loadMoreHistory());
    assert.equal(f.get().model.page.items.length, 2);
    assert.match(f.get().model.historyLoadError, /成長紀錄版本已更新/);

    // Clean next page succeeds, deduplicates hist-30, clears error, and hides load more.
    driftAuthority = false;
    await f.act(a => a.loadMoreHistory());
    assert.deepEqual(f.get().model.page.items.map(i => i.id), ["active-1", "hist-30", "hist-31"]);
    assert.equal(f.get().model.page.historyHasMore, false);
    assert.equal(f.get().model.page.historyNextCursor, null);
    assert.equal(f.get().model.historyLoadError, "");

    const hosts2 = renderCandidates(f.get().model, f.get().actions);
    assert.equal(hosts2.some(n => n.type === "AppButton" && n.props.label === "載入較早建議"), false);

    // Concerns cursor pagination also works cleanly.
    await f.act(a => a.loadMoreConcerns());
    assert.deepEqual(f.get().model.page.concerns.items.map(i => i.id), ["con-1", "con-2"]);
    assert.equal(f.get().model.page.concerns.hasMore, false);
    assert.ok(growthCalls >= 4);
  } finally {
    f.close();
  }
});

test("usePhotoInputSources loadMore appends shared inputs, preserves order on error, and advances cursor", async () => {
  const mocks = {};
  const h = harness(mocks);
  let active = true;
  let value;
  const sourceItem = id => ({
    id,
    childId: "child-a",
    ownerUserId: "user-1",
    createdAt: "2026-10-01T00:00:00Z",
    version: 1,
    kind: "personal_source",
    title: `Source ${id}`,
    text: "Synthetic source text",
    sourceUrl: null,
    originLabel: "Parent note",
    fetchState: "not_requested",
    extraction: { state: "not_requested", runId: null, draft: null },
    recordId: null,
    management: { enabled: true, intention: "Synthetic" },
  });
  let pageCall = 0;
  let failMore = false;
  const env = {
    apiBaseUrl: "/api",
    userId: "user-1",
    childId: "child-a",
    childName: "Synthetic",
    scopeKey: "scope-src",
    role: "owner",
    online: true,
    sharedMode: false,
    allows: () => true,
    current: () => active,
    currentIdentity: () => active,
    canStartWrite: () => true,
    invalidate() {},
    accessError() { active = false; },
    owner: {
      fetcher() { assert.fail("Real network forbidden"); },
      draftOwner: { getSnapshot: () => ({ attachments: [] }), subscribe: () => () => {} },
    },
    queryClient: { fetchQuery: ({ queryFn }) => queryFn({ signal: new AbortController().signal }) },
  };
  mocks.react = { ...h.react, useId: () => "src-id", memo: fn => fn };
  mocks["../preview/PreviewNavigationGuard"] = { usePreviewNavigation: () => action => action(), usePreviewLeaveGuard() {} };
  mocks["./useDomainEnvironment"] = {
    useDomainEnvironment: () => env,
    forSharedModule: x => x,
    useDomainWriteGuard() {},
  };
  mocks["./ProductionProvider"] = { useProduction: () => ({ actions: { open() {} }, attachSavedPhoto() {} }) };
  mocks["../platform/photo-bytes"] = { photoPreview: () => ({ uri: "synthetic", dispose() {} }), photoSha256() {} };
  mocks["../../../src/client/online-refresh-events"] = { subscribeOnlineRefresh: () => () => {} };
  mocks["../../../src/client/shared-input-api"] = {
    SharedInputApiError: SyntheticApiError,
    createSharedInputApi: () => ({
      resetOnline() {},
      async inputs(_c, _s, _u, opts) {
        pageCall++;
        if (!opts?.cursor) {
          return { inputs: [sourceItem("src-1")], sources: [], canCreate: true, hasMore: true, nextCursor: "cur-src-1" };
        }
        if (failMore) {
          failMore = false;
          throw new Error("Synthetic source fetch failure");
        }
        return { inputs: [sourceItem("src-1"), sourceItem("src-2")], sources: [], canCreate: true, hasMore: false, nextCursor: null };
      },
    }),
  };

  const sources = h.load("src/production/usePhotoInputSources.ts");
  function Host() {
    value = sources.usePhotoInputSources();
    return null;
  }
  try {
    h.render(h.jsx(Host, {}));
    await settle();
    h.render(h.jsx(Host, {}));
    assert.deepEqual(value.model.items.map(i => i.id), ["src-1"]);
    assert.equal(value.model.hasMore, true);

    failMore = true;
    value.actions.loadMore();
    await settle();
    h.render(h.jsx(Host, {}));
    assert.deepEqual(value.model.items.map(i => i.id), ["src-1"]);
    assert.match(value.model.pageError, /未能載入更多來源/);

    value.actions.loadMore();
    await settle();
    h.render(h.jsx(Host, {}));
    assert.deepEqual(value.model.items.map(i => i.id), ["src-1", "src-2"]);
    assert.equal(value.model.hasMore, false);
    assert.equal(value.model.pageError, "");
    assert.equal(pageCall, 3);
  } finally {
    h.unmount();
  }
});
