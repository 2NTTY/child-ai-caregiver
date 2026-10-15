import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { agentDirectActionSchema, agentPolicyUpdateSchema } from "../src/shared/agent-actions.ts";
import type { AgentActionReceipt, AgentDirectAction, AgentOperationPolicy, AgentPolicyUpdate, AgentPrivateNote } from "../src/shared/agent-actions.ts";
import type { ContactBinding, ContactPage } from "../src/shared/contact.ts";
import type { FamilyRole } from "../src/shared/family.ts";
import type { CareTask } from "../src/shared/tasks.ts";
import type { AgentScope } from "./agent-runtime.ts";
import { createCareStore } from "./care.ts";
import { createContactStore, type ContactServices } from "./contact-store.ts";
import { FamilyError, READ_ROLES, WRITE_ROLES, requireFamilyVersion, withChildAccess } from "./family-access.ts";
import { appendOnlineChange } from "./online-change.ts";
import { canonicalJson } from "./online-routing.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { createTaskStore, type TaskScheduling } from "./tasks.ts";
import { transactionPool } from "./transaction-pool.ts";
import { groundedRecordTime } from "./agent-record-time.ts";
import { groundedRecordQuantity, type QuantityGrounding } from "./agent-record-quantity.ts";

interface Space { id: string; access_version: number; storage_epoch: string; change_seq: string }
interface VersionRow { version: number; payload_encrypted: string }
interface PolicySaved { value: Omit<AgentOperationPolicy, "effective">; accessVersion: number; storageEpoch: string }
interface NoteRow extends VersionRow { id: string; child_id: string; owner_user_id: string; source_message_id: string }
interface ReceiptRow { id: string; run_id: string; child_id: string; owner_user_id: string; source_message_id: string;
  request_encrypted: string; payload_encrypted: string }
interface RunRow { id: string; child_id: string; owner_user_id: string; source_message_id: string | null;
  trigger_kind: string; authorization_version: string; data_version: string; state: string; unexpired: boolean }
interface ManualRow { child_id: string; storage_epoch: string; kind: string; request_encrypted: string; result_encrypted: string }
interface TaskAuthorizationRow { task_id: string; policy_version: number; grant_version: number }
const emptyPolicy = (): AgentOperationPolicy => ({ version: 0, effective: false, recordKinds: [], allowPrivateNotes: false, allowRecordCorrections: false,
  allowSelfTasks: false, reminderConsentVersion: null, reminderBindings: [] });
const conflict = (code = "agent_action_changed") => new FamilyError(409, code);
const missing = () => new FamilyError(404, "not_found");
const fingerprint = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const policyAad = (userId: string, childId: string, version: number) => `agent-policy:${childId}:${userId}:${version}`;
const noteAad = (userId: string, childId: string, id: string, version: number) => `agent-private-note:${childId}:${userId}:${id}:${version}`;
const receiptAad = (row: ReceiptRow | { id: string; run_id: string; child_id: string; owner_user_id: string }) =>
  `agent-action:${row.child_id}:${row.owner_user_id}:${row.run_id}:${row.id}`;
const manualAad = (userId: string, childId: string, operationId: string, epoch: string) => `agent-manual-operation:${childId}:${userId}:${operationId}:${epoch}`;
const sameBinding = (a: ContactBinding, b: ContactBinding) => a.channel === b.channel && a.bindingId === b.bindingId && a.bindingVersion === b.bindingVersion;
const sameBindings = (a: ContactBinding[], b: ContactBinding[]) => a.length === b.length
  && new Set(a.map(value => value.channel)).size === a.length && a.every(value => b.some(other => sameBinding(value, other)));
const deleteInputSchema = z.object({ expectedVersion: z.number().int().positive().max(2147483646),
  confirmDelete: z.literal(true), operationId: z.uuid() }).strict();

/** Executes only current interactive user statements inside a single workspace transaction. */
export function createAgentActionsStore(pool: Pool, cipher: StorageCipher, scheduling?: TaskScheduling, contactServices?: ContactServices) {
  const access = <T>(userId: string, childId: string, write: boolean,
    fn: (client: PoolClient, space: Space, role: FamilyRole) => Promise<T>): Promise<T | null> =>
    withChildAccess(pool, userId, childId, READ_ROLES, async (client, role, workspaceId) => {
      const space = (await client.query<Space>("SELECT id,access_version,storage_epoch,change_seq::text FROM workspaces WHERE id=$1", [workspaceId])).rows[0];
      return fn(client, space, role);
    }, write);
  async function policyFor(client: PoolClient, space: Space, role: FamilyRole, userId: string, childId: string): Promise<AgentOperationPolicy> {
    const row = (await client.query<VersionRow>("SELECT version,payload_encrypted FROM agent_operation_policies WHERE user_id=$1 AND child_id=$2", [userId, childId])).rows[0];
    if (!row) return emptyPolicy();
    const saved = JSON.parse(cipher.decrypt(row.payload_encrypted, policyAad(userId, childId, row.version))) as PolicySaved;
    return { ...saved.value, allowRecordCorrections: saved.value.allowRecordCorrections === true,
      effective: WRITE_ROLES.includes(role) && saved.accessVersion === space.access_version && saved.storageEpoch === space.storage_epoch };
  }
  async function manualResult<T>(client: PoolClient, space: Space, userId: string, childId: string, operationId: string, kind: string, request: unknown): Promise<{ found: false } | { found: true; value: T }> {
    const row = (await client.query<ManualRow>("SELECT * FROM agent_manual_operations WHERE user_id=$1 AND operation_id=$2", [userId, operationId])).rows[0];
    if (!row) return { found: false };
    const context = manualAad(userId, childId, operationId, space.storage_epoch);
    if (row.child_id !== childId || row.storage_epoch !== space.storage_epoch || row.kind !== kind
      || cipher.decrypt(row.request_encrypted, context + ":request") !== canonicalJson(request)) throw conflict("operation_conflict");
    return { found: true, value: JSON.parse(cipher.decrypt(row.result_encrypted, context + ":result")) as T };
  }
  async function saveManual(client: PoolClient, space: Space, userId: string, childId: string, operationId: string, kind: string, request: unknown, result: unknown) {
    const context = manualAad(userId, childId, operationId, space.storage_epoch);
    await client.query(`INSERT INTO agent_manual_operations(user_id,operation_id,child_id,storage_epoch,kind,request_encrypted,result_encrypted)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [userId, operationId, childId, space.storage_epoch, kind,
      cipher.encrypt(canonicalJson(request), context + ":request"), cipher.encrypt(JSON.stringify(result), context + ":result")]);
  }
  async function contactPage(client: PoolClient, userId: string, childId: string): Promise<ContactPage | null> {
    if (!contactServices) return null;
    const borrowed = transactionPool(client);
    const page = await createContactStore(borrowed.pool, cipher, contactServices).page(userId, childId);
    borrowed.assertReleased(); return page;
  }
  function reminderMatches(policy: Pick<AgentOperationPolicy, "reminderConsentVersion" | "reminderBindings">, page: ContactPage | null) {
    return Boolean(page?.consent.enabled && policy.reminderBindings.length && page.consent.version === policy.reminderConsentVersion
      && sameBindings(policy.reminderBindings, page.consent.bindings)
      && policy.reminderBindings.every(binding => page.availableBindings.some(active => sameBinding(binding, active))));
  }
  async function reconcileTaskAuthorizations(client: PoolClient, userId: string, childId: string,
    previous: AgentOperationPolicy, next: AgentOperationPolicy) {
    const links = (await client.query<TaskAuthorizationRow>(`SELECT task_id,policy_version,grant_version FROM agent_task_authorizations
      WHERE user_id=$1 AND child_id=$2 ORDER BY task_id`, [userId, childId])).rows;
    if (!links.length) return;
    const unchanged = previous.allowSelfTasks && next.allowSelfTasks && next.reminderBindings.length > 0
      && previous.reminderConsentVersion === next.reminderConsentVersion && sameBindings(previous.reminderBindings, next.reminderBindings);
    if (!contactServices) {
      if (!unchanged) throw conflict("contact_services_required_for_revocation");
      await client.query("UPDATE agent_task_authorizations SET policy_version=$3 WHERE user_id=$1 AND child_id=$2", [userId, childId, next.version]);
      return;
    }
    const page = await contactPage(client, userId, childId);
    if (!page) throw conflict("contact_services_required_for_revocation");
    const borrowed = transactionPool(client), tasks = createTaskStore(borrowed.pool, cipher), contacts = createContactStore(borrowed.pool, cipher, contactServices);
    for (const link of links) {
      const task = await tasks.get(userId, childId, link.task_id); borrowed.assertReleased();
      const grant = page.grants.find(value => value.taskId === link.task_id);
      const owned = task && grant && grant.version === link.grant_version && grant.authorizedBy === userId;
      if (owned && task.occurrence.state === "scheduled" && unchanged) {
        await client.query("UPDATE agent_task_authorizations SET policy_version=$4 WHERE user_id=$1 AND child_id=$2 AND task_id=$3", [userId, childId, link.task_id, next.version]);
        continue;
      }
      // A later manual grant has a different version and is outside this policy's ownership.
      if (owned && task.occurrence.state === "scheduled") {
        const revoked = await contacts.saveGrant(userId, childId, task.id, { expectedVersion: grant.version, expectedTaskVersion: task.version,
          enabled: false, allowFollowUp: false, allowFallback: false, backupUserId: null, validUntil: grant.validUntil,
          confirm: true, content: "generic_notice", trigger: "task_due" });
        borrowed.assertReleased();
        if (!revoked) throw conflict("contact_revocation_not_authorized");
      }
      await client.query("DELETE FROM agent_task_authorizations WHERE user_id=$1 AND child_id=$2 AND task_id=$3", [userId, childId, link.task_id]);
    }
    borrowed.assertReleased();
  }
  function decodeNote(row: NoteRow): AgentPrivateNote {
    return JSON.parse(cipher.decrypt(row.payload_encrypted, noteAad(row.owner_user_id, row.child_id, row.id, row.version)));
  }
  async function noteFor(client: PoolClient, userId: string, childId: string, id: string) {
    return (await client.query<NoteRow>("SELECT * FROM agent_private_notes WHERE id=$1 AND child_id=$2 AND owner_user_id=$3 FOR UPDATE", [id, childId, userId])).rows[0];
  }
  async function saveNote(client: PoolClient, userId: string, value: AgentPrivateNote, create: boolean) {
    const encrypted = cipher.encrypt(JSON.stringify(value), noteAad(userId, value.childId, value.id, value.version));
    if (create) await client.query(`INSERT INTO agent_private_notes(id,child_id,owner_user_id,version,source_message_id,payload_encrypted,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [value.id, value.childId, userId, value.version, value.sourceMessageId, encrypted, value.createdAt, value.updatedAt]);
    else await client.query("UPDATE agent_private_notes SET version=$2,source_message_id=$3,payload_encrypted=$4,updated_at=$5 WHERE id=$1", [value.id, value.version, value.sourceMessageId, encrypted, value.updatedAt]);
    await client.query(`INSERT INTO agent_private_note_revisions(note_id,version,child_id,owner_user_id,source_message_id,payload_encrypted)
      VALUES($1,$2,$3,$4,$5,$6)`, [value.id, value.version, value.childId, userId, value.sourceMessageId, encrypted]);
  }
  async function invalidateSummary(client: PoolClient, userId: string, childId: string) {
    await client.query("UPDATE conversation_summaries SET invalidated=true WHERE child_id=$1 AND owner_user_id=$2", [childId, userId]);
  }
  function decodeReceipt(row: ReceiptRow): AgentActionReceipt {
    return (JSON.parse(cipher.decrypt(row.payload_encrypted, receiptAad(row))) as { receipt: AgentActionReceipt }).receipt;
  }
  async function receiptRows(client: PoolClient, userId: string, childId: string, runId: string) {
    return (await client.query<ReceiptRow>("SELECT * FROM agent_action_receipts WHERE run_id=$1 AND owner_user_id=$2 AND child_id=$3 ORDER BY created_at,id LIMIT 8", [runId, userId, childId])).rows;
  }
  async function taskNotification(client: PoolClient, userId: string, childId: string, task: CareTask, policy: AgentOperationPolicy): Promise<Pick<AgentActionReceipt, "notification" | "channels">> {
    const none = { notification: "not_authorized" as const, channels: [] };
    if (!contactServices || !policy.reminderBindings.length || Date.parse(task.occurrence.dueAt) >= Date.now() + 364 * 86400000) return none;
    const page = await contactPage(client, userId, childId);
    if (!reminderMatches(policy, page)) return none;
    const old = page!.grants.find(value => value.taskId === task.id);
    // A revoked task grant stays revoked, even if broader ordinary-task policy remains.
    if (old && !old.enabled) return none;
    const borrowed = transactionPool(client);
    const saved = await createContactStore(borrowed.pool, cipher, contactServices).saveGrant(userId, childId, task.id, {
      expectedVersion: old?.version ?? 0, expectedTaskVersion: task.version, enabled: true, allowFollowUp: false,
      allowFallback: false, backupUserId: null, validUntil: new Date(Date.parse(task.occurrence.dueAt) + 86400000).toISOString(),
      confirm: true, content: "generic_notice", trigger: "task_due",
    });
    borrowed.assertReleased();
    if (saved) await client.query(`INSERT INTO agent_task_authorizations(child_id,user_id,task_id,policy_version,grant_version)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(child_id,user_id,task_id) DO UPDATE SET policy_version=$4,grant_version=$5`,
      [childId, userId, task.id, policy.version, saved.version]);
    return saved ? { notification: "authorized_for_due_event", channels: [page!.consent.bindings[0].channel] } : none;
  }
  const api = {
    records(userId: string, childId: string, query: string) {
      return createCareStore(pool, cipher, true).search(userId, childId, { query });
    },
    policy(userId: string, childId: string): Promise<AgentOperationPolicy | null> {
      return access(userId, childId, false, (client, space, role) => policyFor(client, space, role, userId, childId));
    },
    savePolicy(userId: string, childId: string, raw: AgentPolicyUpdate): Promise<AgentOperationPolicy | null> {
      const input = agentPolicyUpdateSchema.parse(raw);
      return access(userId, childId, true, async (client, space, role) => {
        // Operation identifiers are caller-wide, including separate family workspaces.
        await client.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [userId]);
        const retry = await manualResult<AgentOperationPolicy>(client, space, userId, childId, input.operationId, "policy", input);
        if (retry.found) {
          const live = await policyFor(client, space, role, userId, childId);
          return { ...retry.value, effective: retry.value.effective && live.effective && live.version === retry.value.version };
        }
        const current = await policyFor(client, space, role, userId, childId);
        requireFamilyVersion(current.version, input.expectedVersion);
        if ((input.recordKinds.length || input.allowPrivateNotes || input.allowSelfTasks || input.allowRecordCorrections) && !WRITE_ROLES.includes(role)) throw missing();
        if (input.reminderBindings.length && !reminderMatches(input, await contactPage(client, userId, childId))) throw conflict("contact_consent_changed");
        const { recordKinds, allowPrivateNotes, allowSelfTasks, allowRecordCorrections, reminderConsentVersion, reminderBindings } = input;
        const value: AgentOperationPolicy = { version: current.version + 1, effective: WRITE_ROLES.includes(role),
          recordKinds, allowPrivateNotes, allowSelfTasks, allowRecordCorrections, reminderConsentVersion, reminderBindings };
        const { effective: _effective, ...permissions } = value;
        const payload = cipher.encrypt(JSON.stringify({ value: permissions, accessVersion: space.access_version, storageEpoch: space.storage_epoch } satisfies PolicySaved), policyAad(userId, childId, value.version));
        await client.query(`INSERT INTO agent_operation_policies(user_id,child_id,version,payload_encrypted) VALUES($1,$2,$3,$4)
          ON CONFLICT(user_id,child_id) DO UPDATE SET version=$3,payload_encrypted=$4`, [userId, childId, value.version, payload]);
        await client.query("INSERT INTO agent_policy_revisions(user_id,child_id,version,payload_encrypted) VALUES($1,$2,$3,$4)", [userId, childId, value.version, payload]);
        await reconcileTaskAuthorizations(client, userId, childId, current, value);
        await appendOnlineChange(client, space.id, "preferences", childId, false, userId);
        await saveManual(client, space, userId, childId, input.operationId, "policy", input, value);
        return value;
      });
    },
    notes(userId: string, childId: string, query = "", afterId?: string): Promise<{ items: AgentPrivateNote[]; nextAfterId: string | null } | null> {
      z.string().max(2000).parse(query); if (afterId) z.uuid().parse(afterId);
      return access(userId, childId, false, async client => {
        const rows = (await client.query<NoteRow>(`SELECT * FROM agent_private_notes WHERE owner_user_id=$1 AND child_id=$2
          AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT 201`, [userId, childId, afterId ?? null])).rows;
        const items: AgentPrivateNote[] = [], search = query.toLocaleLowerCase("zh-HK"); let scanned = 0;
        for (const row of rows.slice(0, 200)) {
          scanned++; const value = decodeNote(row);
          if ((value.title + "\n" + value.text).toLocaleLowerCase("zh-HK").includes(search)) items.push(value);
          if (items.length === 20) break;
        }
        return { items, nextAfterId: scanned < rows.length ? rows[scanned - 1].id : null };
      });
    },
    deleteNote(userId: string, childId: string, noteId: string, raw: z.infer<typeof deleteInputSchema>): Promise<boolean | null> {
      z.uuid().parse(noteId); const input = deleteInputSchema.parse(raw), request = { noteId, ...input };
      return access(userId, childId, true, async (client, space) => {
        await client.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [userId]);
        const retry = await manualResult<boolean | null>(client, space, userId, childId, input.operationId, "delete_note", request);
        if (retry.found) return retry.value;
        const row = await noteFor(client, userId, childId, noteId);
        if (row) {
          requireFamilyVersion(row.version, input.expectedVersion);
          await client.query("DELETE FROM agent_private_notes WHERE id=$1 AND owner_user_id=$2 AND child_id=$3", [noteId, userId, childId]);
          await invalidateSummary(client, userId, childId);
          await appendOnlineChange(client, space.id, "memory", childId, true, userId);
        }
        // Deletion receipts retain identifiers and the result, never deleted note contents.
        await saveManual(client, space, userId, childId, input.operationId, "delete_note", request, row ? true : null);
        return row ? true : null;
      });
    },
    receipts(userId: string, childId: string, runId: string): Promise<AgentActionReceipt[] | null> {
      z.uuid().parse(runId);
      return access(userId, childId, false, async client => {
        if (!(await client.query("SELECT 1 FROM agent_runs WHERE id=$1 AND child_id=$2 AND owner_user_id=$3", [runId, childId, userId])).rowCount) return null;
        return (await receiptRows(client, userId, childId, runId)).map(decodeReceipt);
      });
    },
    execute(scope: AgentScope, runId: string, callId: string, raw: AgentDirectAction): Promise<AgentActionReceipt | null> {
      z.uuid().parse(runId); z.string().min(1).max(200).parse(callId);
      const input = agentDirectActionSchema.parse(raw), requestHash = fingerprint(input);
      return access(scope.userId, scope.childId, true, async (client, space, role) => {
        if (space.id !== scope.workspaceId) throw missing();
        const run = (await client.query<RunRow>(`SELECT *,authorization_version::text,expires_at>clock_timestamp() AS unexpired FROM agent_runs
          WHERE id=$1 AND child_id=$2 AND owner_user_id=$3 FOR UPDATE`, [runId, scope.childId, scope.userId])).rows[0];
        if (!run) throw missing();
        const rows = await receiptRows(client, scope.userId, scope.childId, runId);
        const mapped = (await client.query<{ receipt_id: string }>("SELECT receipt_id FROM agent_action_calls WHERE run_id=$1 AND call_id=$2", [runId, callId])).rows[0];
        const matches = (row: ReceiptRow) => cipher.decrypt(row.request_encrypted, receiptAad(row) + ":request") === requestHash;
        if (mapped) {
          const row = rows.find(value => value.id === mapped.receipt_id);
          if (!row || !matches(row)) throw conflict("agent_call_conflict");
          return decodeReceipt(row);
        }
        const equivalent = rows.find(matches);
        if (equivalent) {
          await client.query("INSERT INTO agent_action_calls(run_id,call_id,receipt_id) VALUES($1,$2,$3)", [runId, callId, equivalent.id]);
          return decodeReceipt(equivalent);
        }
        if (!WRITE_ROLES.includes(role)) throw missing();
        if (run.trigger_kind !== "interactive" || run.state !== "running" || !run.unexpired || !run.source_message_id) throw conflict("agent_run_expired");
        if (run.authorization_version !== String(space.access_version) || scope.authorizationVersion !== String(space.access_version)
          || scope.dataVersion.split(":")[0] !== space.storage_epoch || run.data_version !== space.storage_epoch + ":" + space.change_seq) throw conflict("agent_scope_changed");
        if (rows.length >= 8) throw conflict("agent_action_limit");
        const source = (await client.query<{ text_encrypted: string; created_at: Date }>(`SELECT text_encrypted,created_at FROM chat_messages
          WHERE id=$1 AND child_id=$2 AND owner_user_id=$3 AND author_user_id=$3 AND role='user' FOR SHARE`, [run.source_message_id, scope.childId, scope.userId])).rows[0];
        if (!source) throw missing();
        const original = cipher.decrypt(source.text_encrypted, `chat_messages:${run.source_message_id}:${scope.childId}:${scope.userId}:user::text`);
        if (!original.includes(input.sourceQuote)) throw conflict("agent_source_mismatch");
        const sources = [{ quote: input.sourceQuote, original }];
        for (const ref of input.sourceMessages ?? []) {
          const old = (await client.query<{ text_encrypted: string }>(`SELECT text_encrypted FROM chat_messages
            WHERE id=$1 AND child_id=$2 AND owner_user_id=$3 AND author_user_id=$3 AND role='user'
            AND (created_at,id)<=(SELECT created_at,id FROM chat_messages WHERE id=$4 AND owner_user_id=$3 AND child_id=$2) FOR SHARE`,
            [ref.messageId, scope.childId, scope.userId, run.source_message_id])).rows[0];
          if (!old) throw conflict("agent_source_mismatch");
          const text = cipher.decrypt(old.text_encrypted, `chat_messages:${ref.messageId}:${scope.childId}:${scope.userId}:user::text`);
          if (!text.includes(ref.quote)) throw conflict("agent_source_mismatch");
          sources.push({ quote: ref.quote, original: text });
        }
        const policy = await policyFor(client, space, role, scope.userId, scope.childId);
        if (!policy.effective || input.expectedPolicyVersion !== policy.version) throw conflict("agent_policy_changed");
        const borrowed = transactionPool(client), tasks = createTaskStore(borrowed.pool, cipher, scheduling);
        let resource: AgentActionReceipt["resource"], state: AgentActionReceipt["state"];
        let quantityGrounding: QuantityGrounding | undefined;
        let notification: Pick<AgentActionReceipt, "notification" | "channels"> = { notification: "not_authorized", channels: [] };
        if (input.kind === "save_record" || input.kind === "revise_record") {
          if (!policy.recordKinds.includes(input.details.kind)) throw conflict("agent_policy_denied");
          const care = createCareStore(borrowed.pool, cipher, true);
          let details = groundedRecordTime(input.details, sources.map(item => item.quote).join("\n"));
          const grounded = sources.map(item => groundedRecordQuantity(input.details.quantity, input.quantityEvidence, item.quote, item.original));
          quantityGrounding = grounded.find(item => item.status === "source_supported") ?? grounded[0];
          details = { ...details, quantity: quantityGrounding.quantity };
          if (input.kind === "revise_record") {
            if (!policy.allowRecordCorrections) throw conflict("agent_policy_denied");
            const originalRecord = await care.get(scope.userId, scope.childId, input.recordId); borrowed.assertReleased();
            if (!originalRecord || originalRecord.authorUserId !== scope.userId) throw missing();
            requireFamilyVersion(originalRecord.version, input.expectedVersion);
            if (originalRecord.details.kind !== input.details.kind || !policy.recordKinds.includes(originalRecord.details.kind as typeof policy.recordKinds[number]))
              throw conflict("agent_policy_denied");
            if (canonicalJson(originalRecord.details.eventTime) === canonicalJson(input.details.eventTime))
              details = { ...details, eventTime: originalRecord.details.eventTime };
            if (canonicalJson(originalRecord.details.quantity) === canonicalJson(input.details.quantity)) {
              details = { ...details, quantity: originalRecord.details.quantity };
              quantityGrounding = { quantity: originalRecord.details.quantity, status: "unchanged" };
            }
          }
          const values = {
            text: input.text, details, source: "依本人預先授權，由 Agent 整理的使用者陳述；未逐項確認為事實",
          };
          const saved = input.kind === "save_record" ? await care.create(scope.userId, scope.childId, values, "preauthorized_user_statement")
            : await care.revise(scope.userId, scope.childId, input.recordId, values, input.expectedVersion, input.reason, "preauthorized_user_statement");
          borrowed.assertReleased(); if (!saved) throw missing();
          if (input.kind === "revise_record") await invalidateSummary(client, scope.userId, scope.childId);
          resource = { kind: "care_record", id: saved.id, version: saved.version }; state = input.kind === "save_record" ? "saved" : "updated";
        } else if (input.kind === "save_private_note" || input.kind === "revise_private_note") {
          if (!policy.allowPrivateNotes) throw conflict("agent_policy_denied");
          const oldRow = input.kind === "revise_private_note" ? await noteFor(client, scope.userId, scope.childId, input.noteId) : undefined;
          if (input.kind === "revise_private_note") {
            if (!oldRow) throw missing(); requireFamilyVersion(oldRow.version, input.expectedVersion);
            if (oldRow.version >= 2147483647) throw conflict("version_conflict");
          }
          const old = oldRow ? decodeNote(oldRow) : null, now = new Date().toISOString();
          const value: AgentPrivateNote = { id: old?.id ?? randomUUID(), childId: scope.childId, version: (old?.version ?? 0) + 1,
            title: input.title, text: input.text, sourceMessageId: run.source_message_id, provenance: "user_statement",
            createdAt: old?.createdAt ?? now, updatedAt: now };
          await saveNote(client, scope.userId, value, !old);
          if (old) await invalidateSummary(client, scope.userId, scope.childId);
          await appendOnlineChange(client, space.id, "memory", scope.childId, false, scope.userId);
          resource = { kind: "private_note", id: value.id, version: value.version }; state = old ? "updated" : "saved";
        } else {
          if (!policy.allowSelfTasks) throw conflict("agent_policy_denied");
          let task: CareTask | null;
          if (input.kind === "create_self_task") {
            if (Date.parse(input.dueAt) <= Date.now()) throw conflict("agent_due_not_future");
            task = await tasks.create(scope.userId, scope.childId, { confirm: true, values: { title: input.title, details: input.details,
              kind: "ordinary", assigneeUserId: scope.userId, dueAt: input.dueAt, timeZone: input.timeZone } });
            borrowed.assertReleased(); state = "scheduled";
          } else {
            const current = await tasks.get(scope.userId, scope.childId, input.taskId); borrowed.assertReleased();
            if (!current || current.createdBy !== scope.userId || current.assigneeUserId !== scope.userId || current.kind !== "ordinary") throw missing();
            requireFamilyVersion(current.version, input.expectedVersion);
            if (current.occurrence.state !== "scheduled") throw conflict("version_conflict");
            if (input.action === "reschedule") {
              if (Date.parse(input.dueAt!) <= Date.now()) throw conflict("agent_due_not_future");
              task = await tasks.change(scope.userId, scope.childId, input.taskId, { action: "reschedule", expectedVersion: input.expectedVersion,
                confirm: true, note: input.note, dueAt: input.dueAt!, timeZone: input.timeZone!, assigneeUserId: scope.userId });
            } else task = await tasks.change(scope.userId, scope.childId, input.taskId, { action: input.action, expectedVersion: input.expectedVersion,
              confirm: true, note: input.note });
            borrowed.assertReleased(); state = input.action === "complete" ? "completed" : input.action === "cancel" ? "cancelled" : "scheduled";
          }
          if (!task) throw missing();
          if (task.occurrence.state === "scheduled") notification = await taskNotification(client, scope.userId, scope.childId, task, policy);
          else await client.query("DELETE FROM agent_task_authorizations WHERE user_id=$1 AND child_id=$2 AND task_id=$3", [scope.userId, scope.childId, task.id]);
          resource = { kind: "task", id: task.id, version: task.version };
        }
        borrowed.assertReleased();
        const receipt: AgentActionReceipt = { id: randomUUID(), runId, kind: input.kind, resource, state, ...notification,
          ...(quantityGrounding ? { quantityGrounding: { status: quantityGrounding.status } } : {}), createdAt: new Date().toISOString() };
        const identity = { id: receipt.id, run_id: runId, child_id: scope.childId, owner_user_id: scope.userId };
        // Keep encrypted fingerprints rather than copies of source quotes or deleted text.
        await client.query(`INSERT INTO agent_action_receipts(id,run_id,child_id,owner_user_id,source_message_id,request_encrypted,payload_encrypted)
          VALUES($1,$2,$3,$4,$5,$6,$7)`, [receipt.id, runId, scope.childId, scope.userId, run.source_message_id,
          cipher.encrypt(requestHash, receiptAad(identity) + ":request"),
          cipher.encrypt(JSON.stringify({ receipt, action: { kind: input.kind, requestHash }, sourceMessageId: run.source_message_id, sourceMessageIds: (input.sourceMessages ?? []).map(item => item.messageId), policyVersion: policy.version }), receiptAad(identity))]);
        await client.query("INSERT INTO agent_action_calls(run_id,call_id,receipt_id) VALUES($1,$2,$3)", [runId, callId, receipt.id]);
        await client.query("UPDATE agent_runs SET data_version=$2||':'||(SELECT change_seq::text FROM workspaces WHERE id=$3) WHERE id=$1", [runId, space.storage_epoch, space.id]);
        return receipt;
      });
    },
  };
  return api;
}
export type AgentActionsStore = ReturnType<typeof createAgentActionsStore> & {
  notesByKeys?(userId: string, childId: string, keys: string[]): Promise<{ items: AgentPrivateNote[]; missingKeys: string[]; legacyUnkeyedNotSearched: true }>;
};
