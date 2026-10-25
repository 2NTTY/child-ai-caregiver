import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(root + "/package.json");
const jsx = (type, props, key) => ({ type, props, key });

// Executes the shipped hooks and view functions with synthetic transport and host primitives.
// This checks state transitions and accessibility props, not a browser or live service.
function harness(entry, symbol, args = [], overrides = {}) {
  let cursor = 0, changed = false;
  const slots = [], effects = [], cache = new Map();
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { const next = typeof value === "function" ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; changed = true; } }];
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useMemo(factory, dependencies) {
      const index = cursor++;
      if (!same(slots[index]?.dependencies, dependencies)) slots[index] = { value: factory(), dependencies };
      return slots[index].value;
    },
    useEffect(callback, dependencies) {
      const index = cursor++, previous = slots[index];
      if (!same(previous?.dependencies, dependencies)) {
        const current = { dependencies, cleanup: previous?.cleanup }; slots[index] = current;
        effects.push(() => { current.cleanup?.(); current.cleanup = callback(); });
      }
    },
    useId() { return "synthetic-id"; },
    createContext() { return {Provider: "NavigationProvider"}; }, memo: fn => fn, useContext() { return null; }, useCallback: fn => fn,
    useLayoutEffect(callback, dependencies) { return react.useEffect(callback, dependencies); },
  };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const output = ts.transpileModule(readFileSync(filename, "utf8") + (filename.endsWith("PhotoInputDomains.tsx") ? "\nexport { useProductionPhotos };" : ""), { fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} }; cache.set(filename, module.exports);
    const resolve = name => {
      if (name in overrides) return overrides[name];
      if (name === "react") return react;
      if (name.endsWith("/PreviewNavigationGuard")) return {usePreviewNavigation: () => overrides.__navigate ?? (action => action())};
      if (name.endsWith("/motion/preferences")) return { useMotionPreferences: () => ({ enabled: true, reducedMotion: false, preferenceReady: true }) };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
      if (name === "react-native") return { View: "View", Image: "Image", Platform: {OS: "web"}, Pressable: "Pressable", StyleSheet: { create: value => value } };
      if (name === "react-native-paper") return { Text: "Text", Portal: "Portal", ActivityIndicator: "ActivityIndicator" };
      if (name.endsWith("/theme")) return { colors: {}, radius: {}, readingType: {}, workspaceType: {}, spacing: {}, typeScale: {}, mobileLayout: {breakpoint: 600} };
      if (name.endsWith("/ui")) return Object.fromEntries(["AppButton", "AppTextField", "SectionHeader", "SectionCard", "TextLink"].map(value => [value, value]));
      if (name.endsWith("/useAttachmentReview")) return {useAttachmentReview: () => null};
      if (name.endsWith("/AppStatusBadge")) return { AppStatusBadge: "AppStatusBadge" };
      if (name.endsWith("/AppIcon")) return { AppIcon: "AppIcon" };
      if (name.endsWith("/HomeOverviewItems")) return { HomeOverviewItems: "HomeOverviewItems" };
      if (name === "expo-router/react-navigation") return {};
      if (name === "expo-router") return {usePathname: () => overrides.__path?.() ?? "/sources", useGlobalSearchParams: () => ({})};
      if (name.endsWith("/useContainerWidth")) return {useContainerWidth: () => ({width: 1440})};
      if (name.endsWith("/useContentDeletionFocus")) return {useContentDeletionFocus: () => ({start() {}, rowRef() {}, onClosed() {}})};
      if (name.endsWith("/useContentListMotion")) return {useContentListMotion: () => null};
      if (name.endsWith("/source-styles")) return {sourceStyles: {}};
      if (name.endsWith("/photo-styles")) return {photoStyles: {}};
      if (name.endsWith("/branding")) return {brand: {name: "synthetic"}};
      if (name.endsWith("/AppDialog")) {const d = Object.assign(() => {}, {Title:"Title",Content:"Content",ScrollArea:"ScrollArea",Actions:"Actions"}); return {AppDialog: d};}
      if (name.endsWith("/FormErrorSummary")) return {FormErrorSummary: "FormErrorSummary", FormFieldMessage: "FormFieldMessage"};
      if (name.endsWith("/motion")) return Object.fromEntries(["MotionList", "MotionFeedback", "MotionReveal", "MotionDisclosure"].map(v=>[v,v]));
      const leaf = name.split("/").at(-1);
      if (["SourcesView","PhotosView","PageFrame","AppScrollView","AppCheckbox","ReadStateNotice","StatusAnnouncement","PhotoFilePicker","PhotoRecordForm","SourceComposer","SourceDetails","SourceRecordForm","SourceIntakeConversation"].includes(leaf)) return {[leaf]: leaf, sourceTime: x=>x};
      if (!name.startsWith(".")) { try { return require(name); } catch (error) { throw new Error(`Unmocked native dependency ${name} from ${filename}`, {cause: error}); } }
      const file = path.resolve(path.dirname(filename), name);
      return load(existsSync(file) ? file : existsSync(`${file}.ts`) ? `${file}.ts` : `${file}.tsx`);
    };
    new Function("require", "module", "exports", output)(resolve, module, module.exports);
    return module.exports;
  }
  const renderFunction = load(path.join(root, entry))[symbol];
  return { render(nextArgs = args) {
    args = nextArgs; let result, rounds = 0;
    do {
      assert.ok(++rounds < 12, "Synthetic hook state must settle"); cursor = 0; changed = false;
      result = renderFunction(...args); while (effects.length) effects.shift()();
    } while (changed);
    return result;
  }, async settle() { await new Promise(setImmediate); return this.render(); },
  unmount() { for (const slot of slots) slot?.cleanup?.(); } };
}
const nodes = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(nodes)
  : [tree, ...nodes(tree.props?.children)];
const byType = (tree, name) => nodes(tree).filter(node => node.type === name || node.type?.name === name);
class ApiError extends Error { constructor(status=0, onlineCode=null, confirmed=false) {super('Synthetic offline failure'); Object.assign(this,{status,onlineCode,confirmed});} }
const childId = 'b7ce395d-f847-43b2-986c-e1c48b303de8';
const input = {id:'9f8d68d0-acb5-44aa-86f9-b293084bad52',childId,ownerUserId:'synthetic-user',version:1,createdAt:'2026-10-07T00:00:00Z',canManage:true,kind:'personal_source',sourceNotes:'',sourceId:null,sourceLabel:'Synthetic source A',sourceUrl:null,sourceDateText:null,text:'Synthetic original source text',sha256:'a'.repeat(64),retrievedAt:null,fetchState:'ready',extraction:{state:'not_requested',runId:null,excerpt:null,draft:null,stopReason:null,processedAt:null,model:null},recordId:null,confirmationKind:null,management:{intention:'saved purpose',purpose:'answer_reference',nature:'unspecified',timeScope:'unspecified',validityText:'',enabled:true,modelExcerpt:null}};
function envFor(role = "owner") {
  const counters = { invalidations: 0, accessErrors: [], guard: [], active: true };
  const env = {
    owner: {fetcher() { assert.fail("Unexpected transport outside the synthetic API port"); }, draftOwner: {getSnapshot: () => ({scope: "synthetic-scope", attachments: []}), subscribe: () => () => {}}},
    apiBaseUrl: "https://synthetic.invalid", userId: "synthetic-user", childId, childName: "Synthetic child",
    role, scopeKey: "synthetic-scope", online: true, current: () => counters.active,
    canStartWrite: () => true, accessError: error => counters.accessErrors.push(error),
    invalidate: () => counters.invalidations++, queryClient: {fetchQuery: ({queryFn}) => queryFn()},
  };
  return {env, counters};
}
function navigation() {
  const owner = harness("src/preview/PreviewNavigationGuard.tsx", "PreviewNavigationGuard", [{children: null}], {
    "react-native": {Platform: {OS: "ios"}, StyleSheet: {create: value => value}},
  });
  const value = owner.render().props.value;
  return {value, render: () => owner.render(),
    press(label) { const button = byType(owner.render(), "AppButton").find(node => node.props.label === label); assert.ok(button, label); button.props.onPress(); },
  };
}
function sourceOwner(role = "owner") {
  const {env, counters} = envFor(role), nav = navigation();
  const state = {items: [{...input, canManage: role !== "viewer"}], reads: 0, listReads: 0, writes: 0, error: null, lookup: null, pending: false, navigationRequests: 0};
  const api = {
    inputs: async () => { state.listReads++; if (state.error) throw state.error; return {inputs: state.items, sources: [], canCreate: role !== "viewer"}; },
    input: async (_child, id) => { state.reads++; if (state.error) throw state.error; if (state.lookup) return state.lookup; return state.items.find(item => item.id === id); },
    resetOnline: () => {}, hasPendingOnline: () => state.pending,
    ...Object.fromEntries(["create", "manage", "confirm", "delete", "fetch", "extract"].map(name => [name, async () => {state.writes++; assert.fail("Unexpected source write: " + name);}]))
  };
  const owner = harness("src/production/usePhotoInputSources.ts", "usePhotoInputSources", [], {
    "../../../src/client/shared-input-api": {createSharedInputApi: () => api, SharedInputApiError: ApiError},
    "./useDomainEnvironment": {useDomainEnvironment: () => env, useDomainWriteGuard: (dirty, pending) => {
      counters.guard.push([dirty, pending]); nav.value.register("source", {dirty: !!dirty, pending, scope: "child"});
    }},
    "./ProductionProvider": {useProduction: () => ({chatDraft: "", setChatDraft() {}, openAgentDraft() {}})},
    __navigate: action => {state.navigationRequests++; nav.value.request(action);},
  });
  return {owner, state, api, env, counters, nav};
}
function sourceView(value) {
  return harness("src/components/shared-inputs/SourcesView.tsx", "SourcesView", [{model: value.model, actions: value.actions, onPhotos() {}, onRecord() {}, previewControls: null, production: true}]).render();
}
function sourceRow(value, index = 0) {
  const list = byType(sourceView(value), "MotionList")[0];
  return byType(list.props.renderItem(value.model.items[index], {exiting: false}), "AppButton")[0];
}
async function openSource(fixture) {
  fixture.owner.render(); const value = await fixture.owner.settle(); sourceRow(value).props.onPress(); return fixture.owner.settle();
}
function dirtySource(fixture, value) {
  value.actions.intake.setIntention("unsaved changed purpose"); value = fixture.owner.render();
  value.actions.editDraft({...value.model.draft, text: "unsaved family draft"}); return fixture.owner.render();
}
test("viewer opens their listed private source while every write capability remains blocked", async () => {
  const f = sourceOwner("viewer"); f.owner.render(); let value = await f.owner.settle();
  assert.equal(value.model.canChoose, false); assert.equal(value.model.access, "read_only");
  const button = sourceRow(value); assert.equal(button.props.label, "查看來源"); assert.equal(button.props.disabled, false);
  button.props.onPress(); value = await f.owner.settle();
  assert.equal(value.model.selected.id, input.id); assert.equal(value.model.selected.text, input.text); assert.equal(f.state.reads, 1);
  for (const key of ["canChoose", "canCreate", "canFetch", "canExtract", "canConfirm", "canDelete"]) assert.equal(value.model[key], false, key);
  assert.equal(value.model.formLocked, true);
  assert.equal(byType(sourceView(value), "AppButton").find(node => node.props.label === "新增來源").props.disabled, true);
  const originalDraft = value.model.managementDraft;
  value.actions.management.edit({intention: "blocked"}); value.actions.intake.confirmProposal(); value.actions.fetchContent(); value.actions.extract(); value.actions.confirm(); value.actions.remove();
  value.actions.create({kind: "personal_source", sourceLabel: "blocked", sourceUrl: null, sourceDateText: null, sourceNotes: "", text: "synthetic"}); value.actions.newInput();
  value = f.owner.render(); assert.equal(value.model.managementDraft, originalDraft); assert.equal(value.model.selected.id, input.id); assert.equal(f.state.writes, 0); f.owner.unmount();
});
test("selecting the current source preserves both dirty drafts, form key, and editor without a new read", async () => {
  const f = sourceOwner(); const value = dirtySource(f, await openSource(f));
  assert.equal(value.model.managementDraft.dirty, true); assert.equal(f.counters.guard.at(-1)[0], true);
  const before = {draft: value.model.draft, management: value.model.managementDraft, formKey: value.model.formKey, excerpt: value.model.excerpt};
  const requests = f.state.navigationRequests;
  sourceRow(value).props.onPress(); sourceRow(value).props.onPress(); const next = await f.owner.settle();
  assert.equal(next.model.draft, before.draft); assert.equal(next.model.managementDraft, before.management); assert.equal(next.model.formKey, before.formKey); assert.equal(next.model.excerpt, before.excerpt);
  assert.equal(f.state.reads, 1); assert.equal(f.state.navigationRequests, requests); assert.equal(f.state.writes, 0); f.owner.unmount();
});
test("switching sources uses the real dirty guard: cancel preserves drafts, approved discard alone replaces them", async () => {
  const f = sourceOwner(); f.state.items.push({...input, id: "source-b", sourceLabel: "Synthetic B"});
  let value = dirtySource(f, await openSource(f)); const draft = value.model.draft, management = value.model.managementDraft, formKey = value.model.formKey;
  sourceRow(value, 1).props.onPress(); assert.equal(f.state.reads, 1);
  f.nav.press("繼續編輯"); value = f.owner.render(); assert.equal(value.model.draft, draft); assert.equal(value.model.managementDraft, management);
  sourceRow(value, 1).props.onPress(); f.nav.press("捨棄並離開"); value = await f.owner.settle();
  assert.equal(value.model.selected.id, "source-b"); assert.equal(value.model.draft.text, ""); assert.equal(value.model.managementDraft.dirty, false); assert.equal(value.model.formKey, formKey + 1); assert.equal(f.state.reads, 2); f.owner.unmount();
});
test("late source-switch approval cannot read after current child or identity is invalidated", async () => {
  const f = sourceOwner(); f.state.items.push({...input, id: "source-b"});
  const value = dirtySource(f, await openSource(f)); sourceRow(value, 1).props.onPress(); f.counters.active = false;
  f.nav.press("捨棄並離開"); await f.owner.settle(); assert.equal(f.state.reads, 1); assert.equal(f.counters.invalidations, 0); f.owner.unmount();
});
test("source unknown processing stays locked and cannot switch to another row", async () => {
  const f = sourceOwner(); f.state.items[0] = {...input, extraction: {...input.extraction, state: "unknown", runId: "same-run"}}; f.state.items.push({...input, id: "source-b"});
  const value = await openSource(f); assert.equal(value.model.operation.state, "unknown"); assert.equal(sourceRow(value, 1).props.disabled, true);
  value.actions.openInput(value.model.items[1]); assert.equal(f.state.reads, 1); assert.equal(f.counters.guard.at(-1)[1], true); f.owner.unmount();
});
test("stale source read is not published after the old owner is invalidated and unmounted", async () => {
  const f = sourceOwner(); f.owner.render(); let value = await f.owner.settle(); let resolve;
  f.state.lookup = new Promise(done => resolve = done); value.actions.openInput(value.model.items[0]); value = f.owner.render(); assert.equal(value.model.busy, true);
  f.counters.active = false; f.owner.unmount(); resolve(input); value = await f.owner.settle(); assert.equal(value.model.selected, null); assert.equal(f.counters.invalidations, 0);
});
test("source 403 clears the private list and editor", async () => {
  const f = sourceOwner(); let value = dirtySource(f, await openSource(f)); f.state.error = new ApiError(403, "forbidden"); value.actions.refresh(); value = await f.owner.settle();
  assert.equal(value.model.access, "lost"); assert.equal(value.model.selected, null); assert.deepEqual(value.model.items, []); assert.equal(value.model.managementDraft, null); assert.equal(value.model.draft.text, ""); assert.equal(f.counters.accessErrors.length, 1); f.owner.unmount();
});
const photo = {id: "synthetic-photo", childId, ownerUserId: "synthetic-user", version: 1, visibility: "private", canManage: true,
  fileName: "synthetic.png", state: "ready", recordId: null, source: "Synthetic photo", mimeType: "image/png", bytes: 4, sha256: "a".repeat(64), createdAt: "2026-10-07T00:00:00Z",
  extraction: {state: "not_requested", draft: null, runId: null}};
function photoOwner(kind = "reserve") {
  const {env, counters} = envFor();
  const state = {writes: [], checks: 0, pending: false, result: "unconfirmed", outcome: "unknown", finish: null};
  const write = async (phase, ...args) => {
    state.writes.push({phase, args}); state.pending = true;
    if (state.finish) await state.finish;
    if (state.outcome === "null") {state.pending = false; return null;}
    if (state.outcome === "saved") {state.pending = false; return phase === "delete" ? {deleted: true} : {photo: {...photo, state: phase === "reserve" ? "reserved" : "ready"}, recordId: null};}
    throw new ApiError(0, null, state.outcome === "confirmed");
  };
  const api = {photos: async () => ({photos: kind === "reserve" ? [] : [photo], canCreate: true}), photo: async () => photo,
    content: async () => new Blob(["test"]), resetOnline() {state.pending = false;}, hasPendingOnline: () => state.pending,
    reserve: (...args) => write("reserve", ...args), confirm: (...args) => write("confirm", ...args), delete: (...args) => write("delete", ...args),
    reconcilePending: async () => {state.checks++; if (state.result === "confirmed") {state.pending = false; return {state: "confirmed", result: null};} return {state: state.result};},
    upload: async () => assert.fail("Receipt retry must not start original-byte upload"), extract: async () => assert.fail("No model calls are authorized"),
  };
  const owner = harness("src/production/PhotoInputDomains.tsx", "useProductionPhotos", [], {
    "../../../src/client/photo-api": {createPhotoApi: () => api, PhotoApiError: ApiError},
    "./useDomainEnvironment": {useDomainEnvironment: () => env, useDomainWriteGuard: (...value) => counters.guard.push(value)},
    "./ProductionProvider": {useProduction: () => ({})},
    "./usePhotoInputSources": {usePhotoInputSources: () => ({})}, __path: () => "/photos",
  });
  return {owner, state, api, env, counters};
}
function photoView(value) {return harness("src/components/photos/PhotosView.tsx", "PhotosView", [{model: value.model, actions: value.actions, onCare() {}, scopeKey: value.scopeKey, production: true}]).render();}
const photoRetry = value => byType(photoView(value), "AppButton").find(node => node.props.label === "重試原操作");
async function startPhotoWrite(f, kind) {
  f.owner.render(); let value = await f.owner.settle();
  if (kind === "reserve") {
    value.actions.pickOriginal({fileName: "synthetic.png", mimeType: "image/png", bytes: 4, sha256: "a".repeat(64), imageSource: {uri: "synthetic:no-file"}, readBase64: async () => "", dispose() {}});
    value = f.owner.render(); value.actions.editSource("Synthetic recovery source");
    value = f.owner.render(); assert.equal(value.model.canUpload, true); value.actions.upload();
  } else {
    value.actions.openPhoto(value.model.items[0]); value = await f.owner.settle();
    if (kind === "confirm") {
      value.actions.reviewDraft({...value.model.draft, text: "Synthetic checked family record"}); value = f.owner.render();
      value.actions.setSharedConsent(true); value = f.owner.render(); assert.equal(value.model.canConfirm, true); value.actions.confirmShared();
    } else {
      value.actions.openDeletion(); value = f.owner.render(); value.actions.setDeleteScope(true); value = f.owner.render(); value.actions.setDeleteFinal(true); value = f.owner.render(); value.actions.deletePhoto();
    }
  }
  return f.owner.settle();
}
for (const kind of ["reserve", "confirm", "delete"]) {
  test(`photo ${kind}: only a checked original receipt becomes retryable; retry preserves exact payload`, async () => {
    const f = photoOwner(kind); let value = await startPhotoWrite(f, kind);
    assert.equal(value.model.operation.state, "unknown"); assert.equal(f.state.writes.length, 1); assert.equal(photoRetry(value), undefined);
    value.actions.retryOriginal(); assert.equal(f.state.writes.length, 1, "unchecked unknown cannot retry");
    value.actions.checkOriginal(); value = await f.owner.settle();
    assert.equal(value.model.operation.state, "unconfirmed"); assert.equal(value.model.operation.checked, true); assert.equal(value.model.fresh, false);
    const button = photoRetry(value); assert.ok(button); assert.equal(button.props.disabled, false);
    for (const capability of ["canPick", "canUpload", "canExtract", "canConfirm", "canDelete"]) assert.equal(value.model[capability], false, capability);
    assert.equal(value.model.formLocked, true); assert.equal(f.counters.guard.at(-1)[1], true);
    const original = value.model.original, selected = value.model.selected;
    value.actions.clearEditor(); value.actions.editSource("different payload"); value.actions.editDraft({...value.model.draft, text: "different record"}); value.actions.upload(); value.actions.confirmShared(); value.actions.deletePhoto();
    value = f.owner.render(); assert.equal(value.model.original, original); assert.equal(value.model.selected?.id, selected?.id); assert.equal(f.state.writes.length, 1);
    f.state.outcome = "saved"; button.props.onPress(); button.props.onPress(); value = await f.owner.settle();
    assert.equal(f.state.writes.length, 2); assert.equal(f.state.writes[1].phase, kind);
    const payloadCount = kind === "delete" ? 1 : 2;
    for (let i = 0; i < payloadCount; i++) assert.equal(f.state.writes[1].args[i], f.state.writes[0].args[i], "same original object/payload");
    assert.equal(value.model.operation.state, "saved"); assert.equal(f.counters.guard.at(-1)[1], false); assert.equal(f.state.checks, 1); f.owner.unmount();
  });
}
test("photo receipt retry remains blocked offline, while busy, read-only, revoked, or unconfirmed check is absent", async () => {
  const f = photoOwner(); let value = await startPhotoWrite(f, "reserve");
  f.state.result = "unknown"; value.actions.checkOriginal(); value = await f.owner.settle(); assert.equal(value.model.operation.state, "unknown"); assert.equal(photoRetry(value), undefined);
  value.actions.retryOriginal(); assert.equal(f.state.writes.length, 1);
  f.state.result = "unconfirmed"; value.actions.checkOriginal(); value = await f.owner.settle();
  f.env.online = false; value = f.owner.render(); assert.equal(photoRetry(value).props.disabled, true); value.actions.retryOriginal(); assert.equal(f.state.writes.length, 1);
  f.env.online = true; f.owner.render(); value = await f.owner.settle(); f.env.role = "viewer"; value = f.owner.render(); assert.equal(photoRetry(value).props.disabled, true); value.actions.retryOriginal(); assert.equal(f.state.writes.length, 1);
  f.env.role = "owner"; f.counters.active = false; value.actions.retryOriginal(); assert.equal(f.state.writes.length, 1); f.counters.active = true;
  let finish; f.state.finish = new Promise(resolve => finish = resolve); value = f.owner.render(); value.actions.retryOriginal(); value = f.owner.render();
  assert.equal(value.model.busy, true); assert.equal(photoRetry(value), undefined); value.actions.retryOriginal(); assert.equal(f.state.writes.length, 2); finish(); await f.owner.settle(); f.owner.unmount();
});
for (const {kind, inModal, outcome = "confirmed"} of [
  {kind: "reserve", inModal: false, outcome: "null"},
  {kind: "confirm", inModal: false, outcome: "null"},
  {kind: "delete", inModal: false, outcome: "null"},
  {kind: "reserve", inModal: false}, {kind: "confirm", inModal: false},
  {kind: "delete", inModal: false}, {kind: "delete", inModal: true},
]) {
  test(`photo ${kind} (${outcome}): rendered ${inModal ? "delete modal" : "page"} checks confirmed-unavailable before finishing without retry`, async () => {
    const f = photoOwner(kind); f.state.outcome = outcome;
    let value = await startPhotoWrite(f, kind);
    const button = (tree, label) => byType(tree, "AppButton").find(node => node.props.label === label);
    const checkButton = tree => {
      if (!inModal) return button(tree, "查核原照片操作");
      const modal = nodes(tree).find(node => node.props?.danger && node.props?.visible);
      assert.ok(modal, "delete dialog remains visible for its unresolved original operation");
      return button(modal, "查核原照片刪除");
    };
    let tree = photoView(value);
    assert.equal(value.model.online, true); assert.equal(value.model.load, "ready");
    assert.equal(value.model.operation.state, "confirmed_unavailable"); assert.equal(value.model.operation.checked, false);
    assert.equal(f.state.writes.length, 1); assert.equal(f.state.writes[0].phase, kind);
    if (outcome === "null") {
      assert.equal(f.state.pending, false, "confirmed receipt already retired its transport opId");
      if (kind === "reserve") {assert.ok(value.model.original); assert.equal(value.model.source, "Synthetic recovery source");}
      else {assert.equal(value.model.selected, null); assert.equal(value.model.original, null); assert.equal(value.model.draft.text, ""); assert.equal(value.model.items.length, 0);}
    }
    const original = value.model.original, source = value.model.source;
    value.actions.clearEditor(); value.actions.editSource("Replacement must stay blocked"); value.actions.upload();
    value = f.owner.render(); assert.equal(value.model.original, original); assert.equal(value.model.source, source);
    assert.equal(button(tree, "重試原操作"), undefined); assert.equal(button(tree, "結束待查並核對清單"), undefined);
    assert.equal(button(tree, "返回核對").props.disabled, true); assert.equal(value.model.formLocked, true);
    for (const capability of ["canPick", "canUpload", "canExtract", "canConfirm", "canDelete"]) assert.equal(value.model[capability], false, capability);
    assert.equal(f.counters.guard.at(-1)[1], true);
    value.actions.retryOriginal(); value.actions.finishUnidentified(); value = f.owner.render();
    assert.equal(value.model.operation.checked, false); assert.equal(value.model.operation.state, "confirmed_unavailable");
    assert.equal(f.state.writes.length, 1, "unchecked confirmed operation cannot finish or retry");
    const check = checkButton(tree); assert.ok(check, "confirmed-unavailable needs a rendered recovery control");
    assert.equal(check.props.disabled, false);
    let releaseRead, listReads = 0;
    const readPhotos = f.api.photos;
    f.api.photos = (...args) => {listReads++; return new Promise(resolve => {releaseRead = () => resolve(readPhotos(...args));});};
    check.props.onPress(); value = f.owner.render(); tree = photoView(value);
    assert.equal(listReads, 1); assert.equal(value.model.busy, true); assert.equal(value.model.operation.checked, false);
    assert.equal(checkButton(tree).props.disabled, true); assert.equal(button(tree, "結束待查並核對清單"), undefined);
    assert.equal(button(tree, "重試原操作"), undefined); assert.equal(f.state.writes.length, 1);
    releaseRead(); value = await f.owner.settle(); tree = photoView(value);
    assert.equal(value.model.operation.state, "confirmed_unavailable"); assert.equal(value.model.operation.checked, true);
    assert.equal(value.model.busy, false); assert.equal(button(tree, "重試原操作"), undefined);
    assert.equal(f.state.checks, 0, "already-confirmed operation only rereads results, never retries its receipt");
    value.actions.retryOriginal(); assert.equal(f.state.writes.length, 1);
    if (inModal) {
      const modal = nodes(tree).find(node => node.props?.danger && node.props?.visible);
      const close = button(modal, "返回照片"); assert.equal(close.props.disabled, false); close.props.onPress();
      value = f.owner.render(); tree = photoView(value); assert.equal(value.model.deletion, false);
      assert.equal(value.model.operation.checked, true); assert.equal(f.counters.guard.at(-1)[1], true);
    }
    const finish = button(tree, "結束待查並核對清單"); assert.ok(finish); assert.equal(finish.props.disabled, false);
    f.env.online = false; finish.props.onPress(); f.env.online = true; value = f.owner.render();
    assert.equal(value.model.operation.state, "confirmed_unavailable", "offline cannot release the recovery gate");
    f.counters.active = false; finish.props.onPress(); value = f.owner.render();
    assert.equal(value.model.operation.state, "confirmed_unavailable", "stale identity cannot release the recovery gate");
    f.counters.active = true; finish.props.onPress(); value = f.owner.render(); tree = photoView(value);
    assert.equal(value.model.operation.state, "saved"); assert.equal(f.counters.guard.at(-1)[1], false);
    assert.equal(button(tree, "返回核對").props.disabled, false); assert.equal(button(tree, "重試原操作"), undefined);
    assert.equal(button(tree, "結束待查並核對清單"), undefined); assert.equal(f.state.writes.length, 1);
    if (kind === "reserve") {assert.ok(value.model.original); assert.equal(value.model.reservationUnidentified, true); assert.equal(value.model.canUpload, false);}
    else {assert.equal(value.model.selected, null); assert.equal(value.model.deletion, false);}
    f.owner.unmount();
  });
}


test("photo null receipt: real API/transport retires opId while owner keeps recovery and never posts twice", async () => {
  const requests = [];
  const fetcher = async (url, init = {}) => {
    requests.push({url, init});
    if (url.endsWith("/online/context")) return Response.json({workspaceId: childId, storageEpoch: childId});
    if (url.endsWith("/online/submit") && init.method === "POST") {
      const submission = JSON.parse(init.body);
      return Response.json({state: "confirmed", operation: submission.operation, changeSeq: "1", statusCode: 201, result: null});
    }
    if (url.endsWith("/photos") && init.method === "GET") return Response.json({photos: [], canCreate: true});
    assert.fail(`Unexpected request ${init.method} ${url}`);
  };
  const realApi = harness("../src/client/photo-api.ts", "createPhotoApi", ["", fetcher]).render();
  const f = photoOwner(); Object.assign(f.api, realApi);
  let value = await startPhotoWrite(f, "reserve");
  assert.equal(realApi.hasPendingOnline(), false);
  assert.equal(value.model.operation.state, "confirmed_unavailable"); assert.equal(value.model.operation.checked, false);
  assert.ok(value.model.original); assert.equal(value.model.source, "Synthetic recovery source");
  value.actions.retryOriginal(); value.actions.upload(); value.actions.finishUnidentified();
  value = f.owner.render(); assert.equal(value.model.operation.checked, false);
  value.actions.checkOriginal(); value = await f.owner.settle();
  assert.equal(value.model.operation.checked, true); assert.equal(value.model.reservationUnidentified, true);
  value.actions.retryOriginal(); value.actions.upload(); value.actions.finishUnidentified(); value = f.owner.render();
  value.actions.upload(); value.actions.retryOriginal();
  assert.equal(value.model.operation.state, "saved"); assert.equal(value.model.canUpload, false);
  assert.equal(requests.filter(item => item.url.endsWith("/online/submit") && item.init.method === "POST").length, 1);
  assert.equal(requests.filter(item => item.url.includes("/online/operations/")).length, 0);
  assert.equal(requests.some(item => item.url.endsWith("/content") || item.url.endsWith("/extract")), false);
  f.owner.unmount();
});

for (const failure of [new ApiError(0), new ApiError(403, "forbidden")]) {
  test(`photo null receipt: failed reread (${failure.status}) cannot unlock or restore private data`, async () => {
    const f = photoOwner(); f.state.outcome = "null";
    let value = await startPhotoWrite(f, "reserve"); const original = value.model.original;
    f.api.photos = async () => {throw failure;}; value.actions.checkOriginal(); value = await f.owner.settle();
    if (failure.status === 403) {
      assert.equal(value.model.access, "lost"); assert.equal(value.model.original, null);
      assert.equal(value.model.selected, null); assert.deepEqual(value.model.items, []);
      assert.equal(f.counters.accessErrors.length, 1);
    } else {
      assert.equal(value.model.operation.state, "confirmed_unavailable"); assert.equal(value.model.operation.checked, false);
      assert.equal(value.model.original, original); assert.equal(value.model.source, "Synthetic recovery source");
      assert.equal(f.counters.guard.at(-1)[1], true);
    }
    value.actions.finishUnidentified(); value.actions.retryOriginal(); value.actions.upload();
    assert.equal(f.state.writes.length, 1); f.owner.unmount();
  });
}


test("photo unknown then confirmed-null lookup keeps local recovery until explicit finish", async () => {
  const f = photoOwner(); let value = await startPhotoWrite(f, "reserve");
  assert.equal(value.model.operation.state, "unknown");
  f.state.result = "confirmed"; value.actions.checkOriginal(); value = await f.owner.settle();
  assert.equal(value.model.operation.state, "confirmed_unavailable"); assert.equal(value.model.operation.checked, true);
  assert.equal(f.state.pending, false); assert.equal(f.state.checks, 1); assert.equal(f.state.writes.length, 1);
  assert.ok(value.model.original); assert.equal(value.model.source, "Synthetic recovery source");
  value.actions.retryOriginal(); value.actions.upload(); value.actions.clearEditor(); value = f.owner.render();
  assert.equal(f.state.writes.length, 1); assert.ok(value.model.original); assert.equal(f.counters.guard.at(-1)[1], true);
  value.actions.finishUnidentified(); value = f.owner.render(); assert.equal(value.model.operation.state, "saved");
  assert.equal(value.model.canUpload, false); f.owner.unmount();
});

function resumeCopyView(patch = {}) {
  const f = photoOwner();
  const value = f.owner.render();
  const selected = {...photo, state: "reserved", isUploader: true, ownerLabel: "Synthetic parent", createdAtLabel: "Synthetic date"};
  const original = {fileName: photo.fileName, mimeType: photo.mimeType, bytes: photo.bytes, sha256: photo.sha256,
    imageSource: {uri: "synthetic:no-file"}, readBase64: async () => {assert.fail("Rendering copy must not read original bytes");}};
  const tree = photoView({...value, model: {...value.model, selected, original, access: "editable", load: "ready", fresh: true,
    canUpload: true, canPick: true, ...patch}});
  f.owner.unmount();
  return tree;
}
const copyText = tree => byType(tree, "Text").flatMap(node => [node.props.children].flat()).filter(value => typeof value === "string").join("\n");
const resumeButton = tree => byType(tree, "AppButton").find(node => node.props.label === "繼續上傳同一原檔");

test("photo resume copy: retained original offers continuation without claiming uploaded bytes", () => {
  const tree = resumeCopyView(), text = copyText(tree);
  assert.match(text, /原檔已保留，可繼續上傳同一原檔。/);
  assert.doesNotMatch(text, /請重新選取同一張原照片|原檔已保存/);
  assert.match(text, /本次原檔尚未完整保存/);
  assert.equal(resumeButton(tree).props.disabled, false);
});

test("photo resume copy: absent original asks to reselect and preserves disabled upload", () => {
  const tree = resumeCopyView({original: null, canUpload: false});
  assert.match(copyText(tree), /請重新選取同一張原照片。/);
  assert.doesNotMatch(copyText(tree), /原檔已保留/);
  assert.equal(resumeButton(tree).props.disabled, true);
});

test("photo resume copy: ready attachment has no resume or reselect prompt", () => {
  const tree = resumeCopyView({selected: {...photo, isUploader: true}});
  assert.match(copyText(tree), /原檔已保存/);
  assert.doesNotMatch(copyText(tree), /原檔已保留|請重新選取同一張原照片/);
  assert.equal(resumeButton(tree), undefined);
});

test("photo resume copy: read-only or revoked access exposes no upload guidance", () => {
  for (const access of ["read_only", "lost"]) {
    const tree = resumeCopyView({access, canUpload: false, canPick: false});
    assert.doesNotMatch(copyText(tree), /原檔已保留|請重新選取同一張原照片/);
    assert.equal(resumeButton(tree), undefined);
  }
});

test("photo resume copy: retained originals never override pending or unreadable capability guards", () => {
  for (const patch of [
    {operation: {state: "unknown", phase: "upload", message: "Synthetic pending result"}},
    {busy: true, operation: {state: "saving", phase: "upload", message: "Synthetic pending upload"}},
    {load: "error", fresh: false},
    {online: false, fresh: false},
    {fresh: false},
  ]) {
    const tree = resumeCopyView({...patch, canUpload: false, canPick: false});
    assert.match(copyText(tree), /原檔已保留/);
    assert.equal(resumeButton(tree).props.disabled, true);
    assert.equal(byType(tree, "PhotoFilePicker")[0].props.disabled, true);
  }
});
