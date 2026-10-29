import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import type { FactSource, FactValues } from "../../../src/shared/memory";
import { canManageMemory, factStatusLabels, topicStatusLabels, visibilityLabels, type MemoryFactView, type MemoryTopicView } from "../memory-view-model";
import { AppButton, AppSelect, AppTextField } from "../components/ui";
import { AppCheckbox } from "../components/AppCheckbox";
import { FormDialog } from "../components/FormDialog";
import { FormErrorSummary, FormFieldMessage } from "../components/FormErrorSummary";
import { AppDateTimeField } from "../components/DateTimeFields";
import { colors, spacing } from "../theme";
import { growthStyles as s } from "../components/growth/growth-styles";
import { usePreviewLeaveGuard, usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useProductionTaskKnowledgeMemory } from "./TaskKnowledgeDomains";
import type { MemoryManagementEntity, MemoryManagementIntent } from "./task-knowledge-memory-management";

type Owner = NonNullable<ReturnType<typeof useProductionTaskKnowledgeMemory>>;
type Editor = { kind: "fact"; item: MemoryFactView | null } | { kind: "topic"; item: MemoryTopicView | null };
const text = (max: number) => z.string().max(max).refine(value => !!value.trim() && !/[\u0000\uD800-\uDFFF]/u.test(value));
const raw = (max: number) => z.string().max(max).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value));
const sourceSchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("manual"), description: text(500) }),
  z.object({ kind: z.literal("care_record"), description: text(500), recordId: z.uuid(), version: z.number().int().min(1).max(2147483646) }),
  z.object({ kind: z.literal("private_chat"), description: text(500), messageId: z.uuid() })]);
const valuesSchema = z.object({ key: text(100), content: text(4000), source: sourceSchema, validUntil: z.iso.datetime({ offset: true }).nullable() });

export function TaskKnowledgeMemoryManagement() {
  const owner = useProductionTaskKnowledgeMemory(), [open, setOpen] = useState(false), [editor, setEditor] = useState<Editor | null>(null);
  const trigger = useRef<View>(null), editorHeading = useRef<View>(null), listHeading = useRef<View>(null), editorBody = useRef<View>(null);
  const rowNodes = useRef(new Map<string, View>()), origin = useRef<string | null>(null), windowActive = useRef(true);
  const focusRequest = useRef<{ scope: string; target: "editor" | "list"; previous: Element | null } | null>(null);
  const requestFocus = (target: "editor" | "list") => {
    if (owner && windowActive.current) focusRequest.current = { scope: owner.value.scopeKey, target, previous: Platform.OS === "web" ? document.activeElement : null };
  };
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const blur = () => { windowActive.current = false; focusRequest.current = null; }, focus = () => { windowActive.current = true; };
    window.addEventListener("blur", blur); window.addEventListener("focus", focus);
    return () => { window.removeEventListener("blur", blur); window.removeEventListener("focus", focus); };
  }, []);
  useLayoutEffect(() => {
    const request = focusRequest.current;
    if (!request) return;
    focusRequest.current = null;
    if (!open || !owner || owner.lost || request.scope !== owner.value.scopeKey || !windowActive.current || (request.target === "editor") !== !!editor) return;
    const node = request.target === "editor" ? editorHeading.current : (origin.current ? rowNodes.current.get(origin.current) : null) ?? listHeading.current;
    if (Platform.OS === "web") {
      if (document.activeElement !== document.body && document.activeElement !== request.previous) return;
      const host = node as unknown as HTMLElement | null;
      if (host?.isConnected && !host.hasAttribute("disabled") && host.getAttribute("aria-disabled") !== "true") host.focus();
    } else node?.focus();
  }, [editor, open, owner?.lost, owner?.value.scopeKey]);
  const navigate = usePreviewNavigation(), latest = useRef(owner); latest.current = owner;
  const latestEditor = useRef(editor); latestEditor.current = editor;
  const departure = useRef<{ scope: string; epoch: number; editor: Editor; resolve(accepted: boolean): void } | null>(null);
  const scope = owner?.value.scopeKey, epoch = owner?.management.epoch;
  // Unsubmitted RHF fields live in this presentation, unlike the original
  // owner's frozen submitted payload. A workspace move must ask before losing them.
  usePreviewLeaveGuard(!!editor && !!owner?.management.dirty && !owner.management.pending && !owner.lost,
    false, "child", undefined, false, undefined, () => {
      const current = latest.current;
      if (!editor || !current || current.lost || current.value.scopeKey !== scope || current.management.epoch !== epoch
        || latestEditor.current !== editor || !current.management.discard()) return false;
      return new Promise<boolean>(resolve => { departure.current = { scope: current.value.scopeKey, epoch: current.management.epoch, editor, resolve }; });
    });
  useEffect(() => {
    const pending = departure.current;
    if (!pending) return;
    const current = owner?.management;
    if (!owner || owner.lost || scope !== pending.scope || editor !== pending.editor || !current
      || current.epoch !== pending.epoch || !current.dirty || current.pending || current.busy) {
      departure.current = null;
      pending.resolve(!!owner && !owner.lost && scope === pending.scope && editor === pending.editor
        && !!current && current.epoch === pending.epoch + 1 && !current.dirty && !current.pending && !current.busy);
    }
  }, [owner, scope, editor]);
  // Teardown is not consent. StrictMode and replacement only invalidate receipts.
  useEffect(() => () => { departure.current?.resolve(false); departure.current = null; }, []);
  useEffect(() => {
    if (editor && owner?.management.operation === "saved" && !owner.management.pending && !owner.management.busy) {
      if (Platform.OS !== "web" || document.activeElement === document.body || (editorBody.current as unknown as HTMLElement | null)?.contains(document.activeElement)) requestFocus("list");
      setEditor(null);
    }
  }, [editor, owner?.management.operation, owner?.management.epoch, owner?.management.busy]);
  if (!owner || owner.lost) return null;
  const management = owner.management, role = owner.role ?? "viewer";
  const applyPresentation = (action: () => void) => {
    const current = latest.current;
    if (!current || current.lost || current.value.scopeKey !== scope || current.management.busy || current.management.pending) return;
    // The named leave guard may already have discarded and published. Do not
    // discard twice, or let an old accepted callback clear a replacement editor.
    if (latestEditor.current !== editor) return;
    if ((current.management.dirty || current.management.conflict || current.management.operation !== "none") && !current.management.discard()) return;
    action();
  };
  const close = () => navigate(() => applyPresentation(() => { requestFocus("list"); setEditor(null); }));
  const rowKey = (value: Editor) => `${value.kind}:${value.item?.id ?? "new"}`;
  function edit(value: Editor) { navigate(() => applyPresentation(() => { origin.current = rowKey(value); requestFocus("editor"); setEditor(value); })); }
  const rowRef = (key: string) => (node: View | null) => { if (node) rowNodes.current.set(key, node); else rowNodes.current.delete(key); };
  const latestEntity = (value: MemoryManagementEntity) => { requestFocus("editor"); setEditor(value); };
  return <>
    <View style={s.compactActions}><AppButton ref={trigger} label="管理記憶" variant="quiet" density="compact" onPress={() => setOpen(true)} /></View>
    <FormDialog visible={open} scopeKey={owner.value.scopeKey} title="管理記憶" returnFocusRef={trigger}
      onClose={() => applyPresentation(() => { focusRequest.current = null; setEditor(null); setOpen(false); })}>
      {editor ? <View ref={editorBody} style={s.stack}>
        <View ref={editorHeading} accessibilityRole="header" aria-level={2} tabIndex={-1}><Text style={s.sectionTitle}>{editor.kind === "fact" ? editor.item ? "核對這項事實" : "新增候選事實" : editor.item ? "處理這個話題" : "新增話題"}</Text></View>
        <AppButton label="返回記憶清單" variant="quiet" onPress={close} />
        <MemoryRecovery owner={owner} onLatest={latestEntity} />
        {editor.kind === "fact" ? <FactEditor key={`fact:${editor.item?.id ?? "new"}:${management.epoch}`} owner={owner} basis={editor.item} /> : <TopicEditor key={`topic:${editor.item?.id ?? "new"}:${management.epoch}`} owner={owner} basis={editor.item} />}
      </View> : <View style={s.stack}>
        <View ref={listHeading} accessibilityRole="header" aria-level={2} tabIndex={-1}><Text style={s.sectionTitle}>選擇要核對的資料</Text></View>
        <Text style={s.body}>候選未確認前只供本人；話題狀態不代表任務完成。</Text>
        <MemoryRecovery owner={owner} onLatest={latestEntity} />
        <View style={s.compactActions}><AppButton ref={rowRef("fact:new")} label="新增候選事實" variant="secondary" disabled={owner.busy || management.locked} onPress={() => edit({ kind: "fact", item: null })} />
          <AppButton ref={rowRef("topic:new")} label="新增話題" variant="secondary" disabled={owner.busy || management.locked} onPress={() => edit({ kind: "topic", item: null })} />
          {owner.failed && !management.pending && !management.conflict ? <AppButton label="重試讀取記憶" variant="quiet" disabled={owner.busy || !owner.value.model.online} onPress={owner.refresh} /> : null}</View>
        {owner.failed ? <Text style={s.warning}>最新狀態尚未核對；目前保留已讀取的資料。</Text> : null}
        <Text accessibilityRole="header" aria-level={3} style={s.title}>已取得的事實</Text>
        {owner.facts.map(item => <View key={item.id} style={local.row}>
          <Text style={s.title}>{item.key}</Text><Text selectable numberOfLines={canManageMemory(role, item) && !owner.busy && !management.locked ? 2 : undefined} style={s.body}>{item.content}</Text>
          <Text style={s.meta}>{factStatusLabels[item.status]} · {visibilityLabels[item.visibility]} · 版本 {item.version}</Text>
          {item.sourceState === "changed" ? <Text style={s.warning}>來源已改變，核對後才作決定。</Text> : null}
          {canManageMemory(role, item) ? <AppButton ref={rowRef(`fact:${item.id}`)} label="核對這項事實" accessibilityLabel={`核對事實：${item.key}`} variant="quiet" disabled={owner.busy || management.locked} onPress={() => edit({ kind: "fact", item: structuredClone(item) })} /> : null}
        </View>)}
        {owner.value.model.longTerm.data?.hasMoreFacts ? <AppButton label="載入更多事實" variant="quiet" disabled={owner.busy || !!management.pending} onPress={() => owner.value.reads?.loadMoreFacts?.()} /> : null}
        <Text accessibilityRole="header" aria-level={3} style={s.title}>已取得的話題</Text>
        {owner.topics.map(item => <View key={item.id} style={local.row}>
          <Text style={s.title}>{item.title}</Text><Text selectable numberOfLines={canManageMemory(role, item) && !owner.busy && !management.locked ? 2 : undefined} style={s.body}>{item.note}</Text>
          <Text style={s.meta}>{topicStatusLabels[item.status]} · {visibilityLabels[item.visibility]} · 版本 {item.version}</Text>
          {canManageMemory(role, item) ? <AppButton ref={rowRef(`topic:${item.id}`)} label="處理這個話題" accessibilityLabel={`處理話題：${item.title}`} variant="quiet" disabled={owner.busy || management.locked} onPress={() => edit({ kind: "topic", item: structuredClone(item) })} /> : null}
        </View>)}
        {owner.hasMoreTopics ? <AppButton label="載入更多話題" variant="quiet" disabled={owner.busy || !!management.pending} onPress={owner.moreTopics} /> : null}
        <Text style={s.body}>這裏只列出已讀取的資料。私人資料沿本人權限讀取，不由模型填入已確認事實。</Text>
      </View>}
    </FormDialog>
  </>;
}
const local = StyleSheet.create({ row: { minWidth: 0, gap: spacing.sm, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.line } });

function MemoryRecovery({ owner, onLatest }: { owner: Owner; onLatest(value: MemoryManagementEntity): void }) {
  const management = owner.management, entry = management.pending;
  return <View style={s.smallStack}>
    {management.notice ? <Text style={s.body}>{management.notice}</Text> : null}
    {entry ? <><Text style={s.warning}>{entry.confirmed ? "原操作已確認，清單待讀回；不能再提交。" : "原操作結果未知；原內容、版本及識別保留。"}</Text>
      <Text selectable style={s.meta}>{entry.reference ? `原收據操作：${entry.reference}` : "原操作識別由傳輸層保留，尚未取得確認收據。"}</Text>
      <MemoryOriginalIntent intent={entry.intent} />
      <AppButton label="查原收據並讀取目前清單" variant="secondary" disabled={owner.busy || !owner.value.model.online} onPress={management.check} />
      {!entry.confirmed ? <><AppCheckbox label="我已核對，明確同意沿原識別及內容重試" checked={management.consent} disabled={owner.busy || !owner.value.model.online || !entry.checked} onChange={management.setConsent} />
        <AppButton label="明確重試原記憶操作" disabled={owner.busy || !owner.value.model.online || !entry.checked || !management.consent} onPress={management.retry} />
        <AppButton label="沒有待查識別，解除提交並保留草稿" variant="quiet" disabled={owner.busy || !owner.value.model.online || !entry.checked} onPress={management.dismissUnsent} /></> : null}
    </> : null}
    {management.conflict ? <><Text style={s.warning}>原版本 {management.conflict.original.item.version}；最新版本 {management.conflict.latest?.item.version ?? "尚未取得"}。草稿仍保留，需要明確比較。</Text>
      <AppButton label="讀取最新版本" variant="secondary" disabled={owner.busy || !owner.value.model.online} onPress={management.check} />
      {management.conflict.latest ? <Text selectable style={s.body}>{management.conflict.latest.kind === "fact" ? management.conflict.latest.item.content : management.conflict.latest.item.note}</Text> : null}
      <AppButton label="已比較，保留草稿並使用最新版本" disabled={owner.busy || !management.conflict.latest} onPress={() => { const value = management.useLatest(); if (value) onLatest(value); }} />
    </> : null}
  </View>;
}
type FactFields = { key: string; content: string; sourceKind: FactSource["kind"]; sourceDescription: string; recordId: string; sourceVersion: string; messageId: string; validUntil: string; intendedVisibility: "private" | "family"; reason: string };
const factLabels: Record<keyof FactFields, string> = { key: "記憶欄目", content: "內容", sourceKind: "來源類型", sourceDescription: "來源描述", recordId: "原照顧記錄識別", sourceVersion: "原照顧記錄版本", messageId: "原私人聊天訊息識別", validUntil: "有效期", intendedVisibility: "預期可見範圍", reason: "更正／停用原因" };
const factMessages: Partial<Record<keyof FactFields, string>> = { key: "請填寫 1 至 100 字的欄目，不含無效字元。", content: "請填寫 1 至 4,000 字的內容，不含無效字元。", sourceDescription: "請填寫 1 至 500 字的來源描述，不含無效字元。", recordId: "請填寫有效的原照顧記錄識別（UUID），不會自行推測。", sourceVersion: "請填寫 1 至 2147483646 的整數版本。", messageId: "請填寫有效的原私人訊息識別（UUID），不可猜測。", validUntil: "請選擇有效日期及時間，並包含時區。" };
function FactEditor({ owner, basis }: { owner: Owner; basis: MemoryFactView | null }) {
  const [mode, setMode] = useState<"create" | "confirm" | "revise" | "deactivate" | "delete">(basis ? basis.status === "confirmed" ? "revise" : "confirm" : "create");
  const [confirmed, setConfirmed] = useState(false), [shared, setShared] = useState(false), [error, setError] = useState("");
  const formId = useId();
  const { control, watch, handleSubmit, setError: setFieldError, clearErrors, setFocus, formState: { errors } } = useForm<FactFields>({ defaultValues: { key: basis?.key ?? "", content: basis?.content ?? "", sourceKind: basis?.source.kind ?? "manual",
    sourceDescription: basis?.source.description ?? "", recordId: basis?.source.kind === "care_record" ? basis.source.recordId : "", sourceVersion: basis?.source.kind === "care_record" ? String(basis.source.version) : "",
    messageId: basis?.source.kind === "private_chat" ? basis.source.messageId ?? "" : "", validUntil: basis?.validUntil ?? "", intendedVisibility: basis?.intendedVisibility ?? "private", reason: "" } });
  const fieldId = (name: keyof FactFields) => `${formId}-${name}`;
  const errorEntries = (Object.keys(factLabels) as (keyof FactFields)[]).flatMap(name => {
    const message = errors[name]?.message;
    return message ? [{ field: name, label: factLabels[name], message }] : [];
  });
  function invalid(fields: Partial<Record<keyof FactFields, string>>) {
    clearErrors();
    const names = (Object.keys(factLabels) as (keyof FactFields)[]).filter(name => fields[name]);
    for (const name of names) setFieldError(name, { type: "validate", message: fields[name] });
    if (names[0]) setFocus(names[0]);
  }
  const draft = watch(), management = owner.management, disabled = owner.busy || management.locked, editingValues = !disabled && (mode === "create" || mode === "revise");
  const needsShared = !!basis && (mode === "confirm" ? basis.intendedVisibility === "family" : mode === "revise" && basis.visibility === "family");
  useEffect(() => { setConfirmed(false); setShared(false); }, [basis?.version]);
  function edited() { management.markDirty(); setConfirmed(false); setShared(false); setError(""); clearErrors(); }
  function values(value: FactFields): FactValues {
    const source: FactSource = value.sourceKind === "manual" ? { kind: "manual", description: value.sourceDescription }
      : value.sourceKind === "care_record" ? { kind: "care_record", description: value.sourceDescription, recordId: value.recordId, version: /^\d+$/.test(value.sourceVersion) ? Number(value.sourceVersion) : NaN }
        : { kind: "private_chat", description: value.sourceDescription, ...(value.messageId ? { messageId: value.messageId } : {}) };
    return { key: value.key, content: value.content, source, validUntil: value.validUntil || null };
  }
  const submit = handleSubmit(value => {
    if (disabled || !confirmed || needsShared && !shared) return;
    const payload = values(value), parsed = valuesSchema.safeParse(payload);
    if (["create", "revise", "confirm"].includes(mode) && !parsed.success) {
      if (!editingValues) { setError("原內容或來源未能通過核對；請先選擇更正內容及來源，再明確確認。原文不會截短或猜測補齊。"); return; }
      const fields: Partial<Record<keyof FactFields, string>> = {};
      for (const issue of parsed.error.issues) {
        const name = issue.path[0] === "source" ? ({ description: "sourceDescription", recordId: "recordId", version: "sourceVersion", messageId: "messageId" } as const)[issue.path[1] as "description" | "recordId" | "version" | "messageId"]
          : issue.path[0] === "key" || issue.path[0] === "content" || issue.path[0] === "validUntil" ? issue.path[0] : undefined;
        if (name) fields[name] = factMessages[name];
      }
      if (Object.keys(fields).length) invalid(fields);
      else setError("請核對來源類型及原文；不會自行推測或截短。");
      return;
    }
    if ((mode === "revise" || mode === "deactivate") && !text(500).safeParse(value.reason).success) { invalid({ reason: "請填寫 1 至 500 字的原因，不含無效字元。" }); return; }
    if (!basis) { management.submit({ kind: "create_fact", input: { values: payload, intendedVisibility: value.intendedVisibility } }); return; }
    if (mode === "confirm" || mode === "deactivate") {
      const same = payload.key === basis.key && payload.content === basis.content && payload.validUntil === basis.validUntil && sameFactSource(payload.source, basis.source);
      if (!same) { setError("原內容已修改；請先使用更正，確認及停用不會悄悄保存草稿。"); return; }
    }
    if (mode === "confirm") {
      if (basis.status === "confirmed" || basis.sourceState !== "current" || basis.validUntil && Date.parse(basis.validUntil) <= Date.now()) { setError("此事實需先更正來源或有效期，再明確確認。"); return; }
      management.submit({ kind: "confirm_fact", basis, input: { expectedVersion: basis.version, confirm: true, confirmShared: basis.intendedVisibility === "family" && shared } });
    } else if (mode === "revise") management.submit({ kind: "revise_fact", basis, input: { values: payload, reason: value.reason, expectedVersion: basis.version, confirm: true, confirmShared: basis.visibility === "family" && shared } });
    else if (mode === "deactivate") management.submit({ kind: "deactivate_fact", basis, input: { expectedVersion: basis.version, reason: value.reason } });
    else if (mode === "delete") management.submit({ kind: "delete_fact", basis, input: { expectedVersion: basis.version, confirmDelete: true } });
  });
  function field(name: "key" | "content" | "sourceDescription" | "recordId" | "sourceVersion" | "messageId" | "reason", label: string, multiline = false) {
    return <Controller name={name} control={control} render={({ field: input, fieldState }) => <View>
      <AppTextField ref={input.ref} nativeID={fieldId(name)} label={label} value={input.value} multiline={multiline} onBlur={input.onBlur} disabled={name === "reason" ? disabled : !editingValues}
        error={!!fieldState.error} aria-invalid={!!fieldState.error} aria-describedby={fieldState.error ? `${fieldId(name)}-message` : undefined} onChangeText={value => { edited(); input.onChange(value); }} />
      <FormFieldMessage id={`${fieldId(name)}-message`} error={fieldState.error?.message} />
    </View>} />;
  }
  const history = basis ? owner.value.model.longTerm.data?.histories[basis.id] : null;
  return <View style={s.stack}>
    <FormErrorSummary entries={errorEntries} onFocus={name => { if (name in factLabels) setFocus(name as keyof FactFields); }} />
    <Text style={basis ? s.meta : s.body}>{basis ? `${visibilityLabels[basis.visibility]} · ${factStatusLabels[basis.status]} · 原版本 ${basis.version}` : "新增會先成為只供本人查看的候選，沒有由 AI 寫入已確認事實。"}</Text>
    {basis ? <AppSelect label="這次人工操作" value={mode} options={[{ value: "confirm", label: "確認候選／重新確認停用事實" }, { value: "revise", label: "更正內容及來源" }, { value: "deactivate", label: "標記停用" }, { value: "delete", label: "永久刪除及全部歷史" }]} disabled={disabled} onChange={value => { edited(); setMode(value); }} /> : null}
    {field("key", "記憶欄目（最多 100 字）")}{field("content", "內容（最多 4,000 字）", true)}
    <Controller name="sourceKind" control={control} render={({ field }) => <AppSelect label="來源類型" value={field.value} options={[{ value: "manual", label: "人工描述" }, { value: "care_record", label: "已保存照顧記錄" }, { value: "private_chat", label: "本人私人聊天" }]} disabled={!editingValues} onChange={value => { edited(); field.onChange(value); }} />} />
    {field("sourceDescription", "原來源描述（最多 500 字）", true)}
    {draft.sourceKind === "care_record" ? <>{field("recordId", "原照顧記錄識別")}{field("sourceVersion", "原照顧記錄版本")}</> : draft.sourceKind === "private_chat" ? field("messageId", "原私人聊天訊息識別（不可猜測）") : null}
    {basis?.source.kind === "private_chat" && !basis.source.messageId ? <Text style={s.warning}>私人訊息識別已隱藏；不能猜測補回。如需更正，請明確改用人工來源描述。</Text> : null}
    <Controller name="validUntil" control={control} render={({ field, fieldState }) => <AppDateTimeField ref={field.ref} id={fieldId("validUntil")} errorId={`${fieldId("validUntil")}-message`} error={fieldState.error?.message} onBlur={field.onBlur} label="有效至（可留空，香港時間）" value={field.value} timeZone="Asia/Hong_Kong" optional disabled={!editingValues} onChange={value => { edited(); field.onChange(value); }} />} />
    {!basis ? <Controller name="intendedVisibility" control={control} render={({ field }) => <AppSelect label="確認後的預期可見範圍" value={field.value} options={[{ value: "private", label: "只供本人" }, { value: "family", label: "確認後與家庭共享" }]} disabled={disabled || owner.role === "viewer"} onChange={value => { edited(); field.onChange(value); }} />} /> : null}
    {mode === "revise" || mode === "deactivate" ? field("reason", "更正／停用原因（最多 500 字）", true) : null}
    {needsShared ? <AppCheckbox label="我已核對內容及來源，明確同意這次家庭共享" checked={shared} disabled={disabled || owner.role === "viewer"} onChange={value => { management.markDirty(); setShared(value); setConfirmed(false); }} /> : null}
    <AppCheckbox label={mode === "delete" ? "我明確同意永久刪除這項事實及全部歷史，無法復原" : "我已核對原內容、來源、可見範圍及版本，明確確認這次操作"} checked={confirmed} disabled={disabled} onChange={value => { management.markDirty(); setConfirmed(value); }} />
    <AppButton label={mode === "create" ? "確認建立私人候選" : mode === "delete" ? "確認永久刪除事實與全部歷史" : "確認提交這次人工操作"} variant={mode === "delete" ? "danger" : "primary"} disabled={disabled || !confirmed || needsShared && !shared} onPress={submit} />
    {error ? <Text accessibilityRole="alert" style={s.warning}>{error}</Text> : null}
    {basis ? <><AppButton label="讀取這項事實的版本歷史" variant="quiet" disabled={owner.busy} onPress={() => owner.value.reads?.readFactHistory?.(basis.id, basis.version)} />
      {history?.items.map(item => <View key={item.version} style={s.divider}><Text style={s.meta}>版本 {item.version} · {factStatusLabels[item.status]}</Text>
        <Text selectable style={s.body}>{item.content}</Text>{item.reason ? <Text selectable style={s.body}>原因：{item.reason}</Text> : null}</View>)}
      {history?.hasMore ? <AppButton label="載入更舊事實版本" variant="quiet" disabled={owner.busy} onPress={() => owner.value.reads?.loadMoreFactHistory?.(basis.id, basis.version)} /> : null}</> : null}
  </View>;
}
type TopicFields = { title: string; note: string; visibility: "private" | "family"; status: MemoryTopicView["status"]; resumeAfter: string; reason: string };
const topicLabels: Record<keyof TopicFields, string> = { title: "話題標題", note: "備註", visibility: "可見範圍", status: "話題狀態", resumeAfter: "暫緩時間", reason: "重開原因" };
function TopicEditor({ owner, basis }: { owner: Owner; basis: MemoryTopicView | null }) {
  const terminal = !!basis && ["answered", "resolved"].includes(basis.status);
  const [mode, setMode] = useState<"create" | "change" | "reopen" | "delete">(basis ? terminal ? "reopen" : "change" : "create");
  const [confirmed, setConfirmed] = useState(false), [shared, setShared] = useState(false), [error, setError] = useState("");
  const formId = useId();
  const { control, watch, handleSubmit, setError: setFieldError, clearErrors, setFocus, formState: { errors } } = useForm<TopicFields>({ defaultValues: { title: basis?.title ?? "", note: basis?.note ?? "", visibility: basis?.visibility ?? "private",
    status: basis?.status ?? "pending", resumeAfter: basis?.resumeAfter ?? "", reason: "" } });
  const fieldId = (name: keyof TopicFields) => `${formId}-${name}`;
  const errorEntries = (Object.keys(topicLabels) as (keyof TopicFields)[]).flatMap(name => {
    const message = errors[name]?.message;
    return message ? [{ field: name, label: topicLabels[name], message }] : [];
  });
  function invalid(fields: Partial<Record<keyof TopicFields, string>>) {
    clearErrors();
    const names = (Object.keys(topicLabels) as (keyof TopicFields)[]).filter(name => fields[name]);
    for (const name of names) setFieldError(name, { type: "validate", message: fields[name] });
    if (names[0]) setFocus(names[0]);
  }
  const draft = watch(), management = owner.management, disabled = owner.busy || management.locked;
  useEffect(() => { setConfirmed(false); setShared(false); }, [basis?.version]);
  function edited() { management.markDirty(); setConfirmed(false); setShared(false); setError(""); clearErrors(); }
  const submit = handleSubmit(value => {
    if (disabled || !confirmed) return;
    const fields: Partial<Record<keyof TopicFields, string>> = {};
    if (!basis && !text(200).safeParse(value.title).success) fields.title = "請填寫 1 至 200 字的標題，不含無效字元。";
    if (!raw(2000).safeParse(value.note).success) {
      if (mode === "delete" || mode === "reopen") { setError("原備註未能通過字數及原文核對；不能在本操作中悄悄修改或截短。"); return; }
      fields.note = "備註最多 2,000 字，不能包含無效字元；原文不會截短。";
    }
    if (Object.keys(fields).length) { invalid(fields); return; }
    if (!basis) {
      if (value.visibility === "family" && (!shared || owner.role === "viewer")) return;
      management.submit({ kind: "create_topic", input: { title: value.title, note: value.note, visibility: value.visibility, confirmShared: value.visibility === "family" && shared } });
    } else if (mode === "delete") management.submit({ kind: "delete_topic", basis, input: { expectedVersion: basis.version, confirmDelete: true } });
    else if (mode === "reopen") {
      if (!terminal) { setError("只有已回答／已解決話題可按原因重開；原終態會保留。"); return; }
      if (!text(500).safeParse(value.reason).success) { invalid({ reason: "請填寫 1 至 500 字的重開原因，不含無效字元。" }); return; }
      management.submit({ kind: "reopen_topic", basis, input: { expectedVersion: basis.version, reason: value.reason } });
    } else {
      if (terminal) { setError("原話題已結束；請按原因重開，不能直接改回待處理。"); return; }
      if (value.status === "snoozed" && (!z.iso.datetime({ offset: true }).safeParse(value.resumeAfter).success || Date.parse(value.resumeAfter) <= Date.now())) { invalid({ resumeAfter: "請選擇包含時區的未來時間。" }); return; }
      management.submit({ kind: "change_topic", basis, input: { expectedVersion: basis.version, status: value.status, note: value.note, resumeAfter: value.status === "snoozed" ? value.resumeAfter : null } });
    }
  });
  function field(name: "title" | "note" | "reason", label: string, locked: boolean, multiline = false) {
    return <Controller name={name} control={control} render={({ field: input, fieldState }) => <View>
      <AppTextField ref={input.ref} nativeID={fieldId(name)} label={label} value={input.value} multiline={multiline} onBlur={input.onBlur} disabled={locked}
        error={!!fieldState.error} aria-invalid={!!fieldState.error} aria-describedby={fieldState.error ? `${fieldId(name)}-message` : undefined} onChangeText={value => { edited(); input.onChange(value); }} />
      <FormFieldMessage id={`${fieldId(name)}-message`} error={fieldState.error?.message} />
    </View>} />;
  }
  const history = basis ? owner.topicHistories[basis.id] : null;
  return <View style={s.stack}>
    <FormErrorSummary entries={errorEntries} onFocus={name => { if (name in topicLabels) setFocus(name as keyof TopicFields); }} />
    <Text style={basis ? s.meta : s.body}>{basis ? `${visibilityLabels[basis.visibility]} · ${topicStatusLabels[basis.status]} · 原版本 ${basis.version}` : "新增話題只供釐清及處理；不代表新增任務、已完成或成長關注鏈。"}</Text>
    {basis ? <AppSelect label="這次人工操作" value={mode} options={[...(terminal ? [{ value: "reopen" as const, label: "按原因建立新待處理話題" }] : [{ value: "change" as const, label: "更新原話題狀態" }]), { value: "delete", label: "永久刪除及全部歷史" }]} disabled={disabled} onChange={value => { edited(); setMode(value); }} /> : null}
    {field("title", "話題標題（最多 200 字）", disabled || !!basis)}
    {field("note", "備註（最多 2,000 字）", disabled || mode === "delete" || mode === "reopen", true)}
    {!basis ? <Controller name="visibility" control={control} render={({ field }) => <AppSelect label="可見範圍" value={field.value} options={[{ value: "private", label: "只供本人" }, { value: "family", label: "家庭共享" }]} disabled={disabled || owner.role === "viewer"} onChange={value => { edited(); field.onChange(value); }} />} /> : null}
    {basis && mode === "change" ? <><Controller name="status" control={control} render={({ field }) => <AppSelect label="話題狀態" value={field.value} options={[{ value: "pending", label: "待處理" }, { value: "answered", label: "已回答" }, { value: "snoozed", label: "暫緩" }, { value: "resolved", label: "已解決" }]} disabled={disabled} onChange={value => { edited(); field.onChange(value); }} />} />
      {draft.status === "snoozed" ? <Controller name="resumeAfter" control={control} render={({ field, fieldState }) => <AppDateTimeField ref={field.ref} id={fieldId("resumeAfter")} errorId={`${fieldId("resumeAfter")}-message`} error={fieldState.error?.message} onBlur={field.onBlur} label="暫緩至（香港時間）" value={field.value} timeZone="Asia/Hong_Kong" disabled={disabled} onChange={value => { edited(); field.onChange(value); }} />} /> : null}
    </> : null}
    {mode === "reopen" ? field("reason", "新的重開原因（最多 500 字）", disabled, true) : null}
    {!basis && draft.visibility === "family" ? <AppCheckbox label="我明確同意把此話題與有權家庭成員共享" checked={shared} disabled={disabled || owner.role === "viewer"} onChange={value => { management.markDirty(); setShared(value); setConfirmed(false); }} /> : null}
    <AppCheckbox label={mode === "delete" ? "我明確同意永久刪除此話題及全部歷史，無法復原" : "我已核對內容、可見範圍及原版本，明確確認這次操作"} checked={confirmed} disabled={disabled} onChange={value => { management.markDirty(); setConfirmed(value); }} />
    <AppButton label={mode === "delete" ? "確認永久刪除話題與全部歷史" : mode === "reopen" ? "確認按原因建立新待處理話題" : "確認提交話題"} variant={mode === "delete" ? "danger" : "primary"} disabled={disabled || !confirmed || !basis && draft.visibility === "family" && !shared} onPress={submit} />
    {error ? <Text accessibilityRole="alert" style={s.warning}>{error}</Text> : null}
    {basis ? <><AppButton label="讀取原話題版本歷史" variant="quiet" disabled={owner.busy} onPress={() => owner.topicHistory(basis.id, basis.version)} />
      {history?.items.map(item => <View key={item.version} style={s.divider}><Text style={s.meta}>版本 {item.version} · {topicStatusLabels[item.status]}</Text>
        <Text selectable style={s.body}>{item.note}</Text><Text style={s.meta}>{item.updatedAt}</Text></View>)}
      {history?.cursor ? <AppButton label="載入更舊話題版本" variant="quiet" disabled={owner.busy} onPress={() => owner.topicHistory(basis.id, basis.version, true)} /> : null}</> : null}
  </View>;
}
function sameFactSource(left: FactSource, right: FactSource) {
  if (left.kind !== right.kind || left.description !== right.description) return false;
  if (left.kind === "care_record") return right.kind === "care_record" && left.recordId === right.recordId && left.version === right.version;
  if (left.kind === "private_chat") return right.kind === "private_chat" && left.messageId === right.messageId;
  return true;
}
function MemoryOriginalIntent({ intent }: { intent: MemoryManagementIntent }) {
  const labels: Record<MemoryManagementIntent["kind"], string> = { create_fact: "新增私人候選", confirm_fact: "確認事實", revise_fact: "更正事實", deactivate_fact: "停用事實", delete_fact: "永久刪除事實及全部歷史", create_topic: "新增話題", change_topic: "更新話題狀態", reopen_topic: "按原因重開話題", delete_topic: "永久刪除話題及全部歷史" };
  return <View style={s.smallStack}><Text style={s.title}>原決定：{labels[intent.kind]}</Text>
    {"basis" in intent ? <Text style={s.meta}>原版本 {intent.basis.version} · {visibilityLabels[intent.basis.visibility]}</Text> : null}
    {intent.kind === "create_fact" || intent.kind === "revise_fact" ? <><Text selectable style={s.body}>{intent.input.values.key}：{intent.input.values.content}</Text><Text selectable style={s.body}>來源：{intent.input.values.source.description} · 有效至 {intent.input.values.validUntil ?? "未設定"}</Text></> : null}
    {intent.kind === "create_topic" ? <><Text style={s.body}>{intent.input.title}</Text><Text selectable style={s.body}>{intent.input.note}</Text><Text style={s.meta}>{visibilityLabels[intent.input.visibility]}</Text></> : null}
    {intent.kind === "change_topic" ? <><Text style={s.body}>{topicStatusLabels[intent.input.status]} · 暫緩至 {intent.input.resumeAfter ?? "未設定"}</Text><Text selectable style={s.body}>{intent.input.note}</Text></> : null}
    {"reason" in intent.input ? <Text selectable style={s.body}>原原因：{intent.input.reason}</Text> : null}
    {"confirmShared" in intent.input ? <Text style={s.body}>{intent.input.confirmShared ? "已明確確認家庭共享" : "原請求沒有新的共享確認"}</Text> : null}
  </View>;
}