import { randomUUID } from 'node:crypto';
import type { Query } from '@google-cloud/firestore';
import { z } from 'zod';
import { growthActionSchema, growthTopicActionSchema, growthTopicSchema, GROWTH_KNOWLEDGE_NOTICES,
  type GrowthAction, type GrowthAttention, type GrowthPage, type GrowthTopicAction, type GrowthTopicId } from '../src/shared/growth.ts';
import type { MemoryContext } from '../src/shared/memory.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, firestoreTaskSchema, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import type { FirestoreMemoryStore } from './firestore-memory.ts';
import type { FirestoreCareStore } from './firestore-care.ts';
import type { FirestoreOnlineStore } from './firestore-online.ts';
import type { FirestoreKnowledgeStore } from './firestore-knowledge.ts';
import { GROWTH_RULES, GROWTH_CATALOG_REVISION, growthProposals, growthInputs, growthBasisChanged, nextGrowthCheck } from './growth-rules.ts';
import { agentKnowledgeFilter } from './product-agent-tools.ts';
import { parseKnowledgeFilter } from './knowledge-inputs.ts';
import { profileIsApplicable } from './memory-policy.ts';
import { prepareContextChange } from './firestore-context-basis.ts';
import { prepareFirestoreBackgroundWork, type FirestoreBackgroundWork } from './firestore-background-work.ts';
import { createFirestoreSharingStore } from './firestore-sharing.ts';

const uuid = z.uuid(), time = z.iso.datetime({ offset: true }), version = z.number().int().positive().max(2147483647);
const hash = z.string().regex(/^[a-f0-9]{64}$/u), text = (max: number) => z.string().max(max);
const itemSchema: z.ZodType<GrowthAttention> = z.object({ id: uuid, childId: uuid, topicId: growthTopicSchema, version,
  state: z.enum(['proposed', 'snoozed', 'accepted', 'dismissed', 'inapplicable']), title: text(200), kind: z.enum(['observe', 'arrange', 'consult']),
  whyNow: text(4000), advice: text(4000), limits: text(4000),
  basis: z.object({ stage: text(100), ruleRevision: text(100), sourceHash: hash, values: z.record(text(80), text(80)) }).strict(),
  evidence: z.object({ profileVersion: z.number().int().nonnegative(), facts: z.array(z.object({ id: uuid, version }).strict()).max(8) }).strict(),
  source: z.object({ sourceId: text(100), versionId: uuid, chunkId: uuid, contentHash: hash, url: z.url(), title: text(300),
    section: text(300), checkedAt: time, excerpt: text(24000) }).strict(),
  sourceAvailable: z.boolean(), createdAt: time, updatedAt: time, snoozeUntil: time.nullable(), previousId: uuid.nullable(),
  newReason: text(4000), taskId: uuid.nullable(), taskState: z.enum(['scheduled', 'completed', 'cancelled', 'needs_review']).nullable(),
  lastAction: text(80), actorUserId: text(256).nullable(), note: text(1000),
}).strict();
export const firestoreGrowthSchema = z.object({ item: itemSchema, lastRequest: growthActionSchema.nullable() }).strict();
export const firestoreGrowthTopicSchema = z.object({ topicId: growthTopicSchema, version, disabled: z.boolean(), actor: text(256),
  at: time, request: growthTopicActionSchema }).strict();
const checkSchema = z.object({ childId: uuid, catalog: text(100), at: time, nextAt: time.nullable(), basis: hash }).strict();
type Saved = z.infer<typeof firestoreGrowthSchema>;
type Topic = z.infer<typeof firestoreGrowthTopicSchema>;
const same = (a: unknown, b: unknown) => firestoreDomainHash(a) === firestoreDomainHash(b);
const currentAuthority = (b: Binding) => b.sharedAccess
  ? firestoreDomainHash({ epoch:b.scope.storageEpoch, basis:b.sharedAccess.basis })
  : b.scope.storageEpoch + ':' + b.authorizationVersion;
const active = (item: GrowthAttention) => ['proposed', 'snoozed'].includes(item.state);

/** Reuses the reviewed four-rule catalogue. No model determines medical eligibility or topic suppression. */
export function createFirestoreGrowthStore(options: FirestoreDomainOptions & {
  care: FirestoreCareStore; memory: FirestoreMemoryStore; online: FirestoreOnlineStore; knowledge?: FirestoreKnowledgeStore;
}) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options);
  const sharing = createFirestoreSharingStore(options);
  function sourceBinding(b: Binding, module: 'profile' | 'memory'): Binding {
    if (!b.sharedAccess) return b;
    if (b.sharedAccess.module !== 'growth') domainReject('shared_module_scope', 403);
    // Saved growth content is explicitly shared. These reads validate its basis only;
    // unshared current inputs are never returned as new source content or write capabilities.
    return { ...b, sharedAccess:{ ...b.sharedAccess, module, mode:'read' } };
  }
  function query(b: Binding, suffix: string): Query {
    let q: Query = data.collection(suffix); for (const [key, value] of Object.entries(data.tags(b.scope))) q = q.where(key, '==', value); return q;
  }
  async function all(b: Binding): Promise<Saved[]> {
    const rows = await b.transaction.get(query(b, 'growth_attention').orderBy('createdAt').orderBy('attentionId').limit(501));
    if (rows.size > 500) domainReject('growth_history_requires_review', 400);
    return rows.docs.map(row => {
      const saved = data.open('growth-attention', row.get('attentionId'), b.scope, firestoreGrowthSchema, row);
      if (saved.item.id !== row.get('attentionId') || saved.item.childId !== b.scope.childId || saved.item.version !== row.get('recordVersion')
        || saved.item.createdAt !== row.get('createdAt')) domainReject('growth_binding', 500);
      return saved;
    });
  }
  async function topics(b: Binding): Promise<Topic[]> {
    const result: Topic[] = [];
    for (const rule of GROWTH_RULES) {
      const id = JSON.stringify([b.scope.childId, rule.id]), row = await b.transaction.get(data.ref('growth_topics', 'growth-topic', id));
      if (!row.exists) continue;
      const item = data.open('growth-topic', id, b.scope, firestoreGrowthTopicSchema, row);
      if (item.topicId !== rule.id || item.version !== row.get('recordVersion')) domainReject('growth_binding', 500);
      result.push(item);
    }
    return result;
  }
  async function task(b: Binding, id: string | null) {
    if (!id) return null;
    const row = await b.transaction.get(data.ref('tasks', 'task', id)); if (!row.exists) return null;
    if (Object.entries(data.tags(b.scope)).some(([k, v]) => row.get(k) !== v)) domainReject('not_found', 404);
    const value = data.open('task', id, b.scope, firestoreTaskSchema, row);
    if (value.id !== id || value.childId !== b.scope.childId || value.version !== row.get('recordVersion')) domainReject('task_binding', 500);
    return value;
  }
  async function load(b: Binding) {
    const profile = await options.care.readProfile(sourceBinding(b, 'profile'));
    const facts = await options.memory.readFamilyFacts(sourceBinding(b, 'memory'), GROWTH_RULES.flatMap(rule => rule.inputs.map(input => input.key)));
    const context: MemoryContext = { profile, profileApplicable: profileIsApplicable(profile.data), facts, topics: [], summary: null,
      recentMessages: [], conflictingKeys: [], unavailableFactKeys: facts.filter(f => !f.applicable).map(f => f.key.trim().toLowerCase()),
      truncated: { facts: false, topics: false, messages: false } };
    const filter = agentKnowledgeFilter(context, new Date()), applicable = context.profileApplicable ? profile.data : null;
    let notice: string | null = null;
    if (applicable?.age.kind === 'birth_date' && filter.age === null) notice = GROWTH_KNOWLEDGE_NOTICES.age;
    else if (!applicable?.region?.trim()) notice = GROWTH_KNOWLEDGE_NOTICES.region;
    else { try { parseKnowledgeFilter(filter); } catch (error) { if (!(error instanceof z.ZodError)) throw error; notice = GROWTH_KNOWLEDGE_NOTICES.region; } }
    const sources = !notice && options.knowledge ? await options.knowledge.ruleCandidates(b.transaction, GROWTH_RULES, filter) : [];
    const assessed = growthProposals(context, sources, new Date());
    return { context, sources, proposals: assessed.proposals, notices: notice ? [notice] : assessed.notices };
  }
  async function visible(b: Binding, item: GrowthAttention, loaded: Awaited<ReturnType<typeof load>>) {
    const next = loaded.proposals.find(value => value.topicId === item.topicId);
    const mayReadTask = !b.sharedAccess || !!b.sharedAccess.modules?.includes('tasks');
    const linked = mayReadTask ? await task(b, item.taskId) : null;
    return { ...item, sourceAvailable: !!next && same(next.basis, item.basis),
      taskId:mayReadTask ? item.taskId : null, taskState: linked?.occurrence.state ?? null };
  }
  function write(b: Binding, saved: Saved) {
    domainParse(firestoreGrowthSchema, saved); const item = saved.item, id = JSON.stringify([item.id, item.version]);
    const tags = { ...data.tags(b.scope), attentionId: item.id, createdAt: item.createdAt, entityVersion: item.version };
    b.transaction.set(data.ref('growth_attention', 'growth-attention', item.id),
      { ...tags, ...data.seal('growth-attention', item.id, b.scope, firestoreGrowthSchema, saved, item.version) });
    b.transaction.create(data.ref('growth_revisions', 'growth-revision', id),
      { ...tags, ...data.seal('growth-revision', id, b.scope, firestoreGrowthSchema, saved, item.version) });
  }
  async function page(b: Binding): Promise<GrowthPage> {
    const records = await all(b), loaded = await load(b), states = await topics(b);
    const history = records.filter(value => !active(value.item)).reverse(), selected = [...records.filter(value => active(value.item)), ...history.slice(0, 30)];
    const items: GrowthAttention[] = []; for (const saved of selected) items.push(await visible(b, saved.item, loaded));
    const mayReadInputs = !b.sharedAccess || !!b.sharedAccess.modules?.includes('memory');
    return { authorityVersion: currentAuthority(b), items, historyHasMore: history.length > 30, canManage: !b.sharedAccess,
      eligibleAssignees: b.sharedAccess ? [] : [{ userId: b.scope.ownerUserId, name: '本人' }],
      notices: b.sharedAccess ? ['這是已共享的成長內容；共享修改仍未開放。',
        ...(!mayReadInputs ? ['即時近況未加入共享範圍。'] : []),
        ...(items.some(item => !item.sourceAvailable) ? ['部分成長內容的來源適用性已改變或尚未能確認。'] : [])] : loaded.notices,
      topics: GROWTH_RULES.map(rule => { const state = states.find(topic => topic.topicId === rule.id);
        const inputs = growthInputs(rule, loaded.context);
        return { id: rule.id, title: rule.title, version: state?.version ?? 1, disabled: state?.disabled ?? false,
          inputs: mayReadInputs ? inputs : inputs.map(input => ({ ...input, value:null, conflict:false, factRefs:[] })) }; }) };
  }
  const childWake = (b: Binding, basis: string, dueAt = new Date().toISOString()) => prepareFirestoreBackgroundWork(data, b.transaction,
    { kind: 'child-change', scope: b.scope, resourceId: b.scope.childId, basis, generation: b.generation, authorizationVersion: b.authorizationVersion }, dueAt);
  async function backgroundInputIn(b: Binding, job: FirestoreBackgroundWork) {
    if (job.kind !== 'growth' || !same(job.scope, b.scope) || job.generation !== b.generation || job.authorizationVersion !== b.authorizationVersion) return null;
    const saved = (await all(b)).find(value => value.item.id === job.resourceId);
    if (!saved || saved.item.state !== 'proposed' || firestoreDomainHash(saved.item.basis) !== job.basis
      || (await topics(b)).some(value => value.topicId === saved.item.topicId && value.disabled)) return null;
    const item = await visible(b, saved.item, await load(b)); return item.sourceAvailable ? item : null;
  }
  const store = {
    forSharedSpace(spaceId: string) {
      domainParse(uuid, spaceId);
      const unavailable = async (): Promise<never> => domainReject('shared_domain_read_only', 409);
      return {
        list: (u: string, c: string) => sharing.withResource(u, { spaceId, childId:c, module:'growth', mode:'read' }, access => page(access.binding)),
        decide: unavailable, topic: unavailable,
      };
    },
    list: (u: string, c: string) => authority.runTransaction(u, c, page),
    decide: (u: string, c: string, id: string, raw: GrowthAction) => authority.runTransaction(u, c, async b => {
      domainParse(uuid, id); const input = domainParse(growthActionSchema, raw);
      if (input.authorityVersion !== currentAuthority(b)) domainReject('growth_changed');
      const saved = (await all(b)).find(value => value.item.id === id); if (!saved) domainReject('not_found', 404);
      const current = saved.item, loaded = await load(b);
      if (current.version === input.expectedVersion + 1 && current.actorUserId === u && same(saved.lastRequest, input)) return visible(b, current, loaded);
      const disabled = (await topics(b)).find(topic => topic.topicId === current.topicId)?.disabled;
      if (current.version !== input.expectedVersion || !active(current) || disabled || !(await visible(b, current, loaded)).sourceAvailable) domainReject('growth_changed');
      const now = new Date().toISOString(), item = { ...current, version: current.version + 1, updatedAt: now, actorUserId: u, lastAction: input.action };
      let linked: Awaited<ReturnType<FirestoreOnlineStore['prepareTask']>> | null = null;
      if (input.action === 'dismiss') { item.state = 'dismissed'; item.note = input.note; item.snoozeUntil = null; }
      else if (input.action === 'snooze') {
        if (Date.parse(input.until) <= Date.now() || Date.parse(input.until) > Date.now() + 366 * 86400_000) domainReject('invalid_input', 400);
        item.state = 'snoozed'; item.snoozeUntil = input.until;
      } else {
        item.state = 'accepted'; item.snoozeUntil = null;
        if (input.task.kind === 'existing') {
          const selected = await task(b, input.task.id);
          if (!selected || selected.version !== input.task.expectedVersion) domainReject('growth_changed');
          item.taskId = selected.id; item.taskState = selected.occurrence.state;
        } else if (input.task.kind === 'create') {
          const existing = await task(b, current.taskId);
          if (existing && ['scheduled', 'needs_review'].includes(existing.occurrence.state)) domainReject('growth_existing_task_requires_review');
          linked = await options.online.prepareTask(b, c, undefined, { values: input.task.values, confirm: true }, randomUUID());
          item.taskId = linked.task.id; item.taskState = linked.task.occurrence.state;
        }
      }
      const wake = await childWake(b, 'decision:' + item.id + ':' + item.version);
      const change = linked ? null : await b.prepareChange(randomUUID(), 'growth', false), context = await prepareContextChange(data, b);
      change?.commit(); linked?.commit(); context(); wake.commit(); write(b, { item, lastRequest: input }); return item;
    }),
    async topic(u: string, c: string, rawTopic: GrowthTopicId, raw: GrowthTopicAction) {
      const topicId = domainParse(growthTopicSchema, rawTopic), input = domainParse(growthTopicActionSchema, raw);
      await authority.runTransaction(u, c, async b => {
        if (currentAuthority(b) !== input.authorityVersion) domainReject('growth_changed');
        const previous = (await topics(b)).find(topic => topic.topicId === topicId), currentVersion = previous?.version ?? 1;
        if (previous && currentVersion === input.expectedVersion + 1 && previous.actor === u && same(previous.request, input)) return;
        if (currentVersion !== input.expectedVersion) domainReject('growth_changed');
        const loaded = await load(b), rule = GROWTH_RULES.find(value => value.id === topicId)!, records = await all(b);
        const commits: (() => void)[] = [];
        // Compound context confirmation has one change sequence and one transaction, not multiple partial fact writes.
        const nested: Binding = { ...b, prepareChange: async () => ({ changeSeq: (BigInt(b.changeSeq) + 1n).toString(), commit() {} }) };
        if (input.action === 'confirm_context') {
          const facts = loaded.context.facts.filter(fact => rule.inputs.some(def => def.key === fact.key.trim().toLowerCase()));
          if (!same(facts.map(({ id, version }) => ({ id, version })).sort((a, x) => a.id.localeCompare(x.id)),
            [...input.expectedFacts].sort((a, x) => a.id.localeCompare(x.id)))) domainReject('growth_changed');
          const entries = Object.entries(input.values);
          if (!entries.length || entries.some(([key, value]) => !rule.inputs.some(def => def.key === key && def.choices.some(choice => choice.value === value)))) domainReject('invalid_input', 400);
          for (const [key, content] of entries) {
            const fact = facts.find(value => value.key.trim().toLowerCase() === key);
            if (fact && (!fact.applicable || fact.sourceState !== 'current')) domainReject('growth_fact_requires_review');
            const values = { key, content, source: { kind: 'manual' as const, description: '家長在成長關注明確確認，供家庭共同照護使用。' }, validUntil: null };
            if (fact?.content === content) continue;
            const update = fact ? await options.memory.prepareFactChange(nested, 'revise', fact.id,
              { values, expectedVersion: fact.version, confirm: true, confirmShared: true, reason: '家長更新成長關注近況。' }, randomUUID())
              : await options.memory.prepareConfirmedFact(nested, { values, intendedVisibility: 'family' }, true, randomUUID());
            commits.push(update.commit);
          }
        }
        const now = new Date().toISOString(), disabled = input.action === 'set_enabled' ? !input.enabled : previous?.disabled ?? false;
        const next: Topic = { topicId, version: currentVersion + 1, disabled, actor: u, at: now, request: input };
        const removed = disabled ? records.filter(saved => saved.item.topicId === topicId && active(saved.item)) : [];
        if (removed.length > 4) domainReject('growth_history_requires_review', 400);
        const wake = await childWake(b, 'topic:' + topicId + ':' + next.version), context = await prepareContextChange(data, b);
        const change = await b.prepareChange(randomUUID(), commits.length ? 'memory' : 'growth', false);
        const id = JSON.stringify([c, topicId]), revisionId = JSON.stringify([c, topicId, next.version]);
        change.commit(); context(); for (const commit of commits) commit(); wake.commit();
        b.transaction.set(data.ref('growth_topics', 'growth-topic', id), { ...data.tags(b.scope), ...data.seal('growth-topic', id, b.scope, firestoreGrowthTopicSchema, next, next.version) });
        b.transaction.create(data.ref('growth_topic_revisions', 'growth-topic-revision', revisionId),
          { ...data.tags(b.scope), ...data.seal('growth-topic-revision', revisionId, b.scope, firestoreGrowthTopicSchema, next, next.version) });
        for (const saved of removed) write(b, { item: { ...saved.item, version: saved.item.version + 1, state: 'dismissed', snoozeUntil: null,
          updatedAt: now, actorUserId: u, lastAction: 'topic_disabled', note: '已永久停用此主題；只有明確重新啟用才可再評估。' }, lastRequest: null });
      });
      return store.list(u, c);
    },
    async evaluate(job: FirestoreBackgroundWork) {
      return authority.runTransaction(job.scope.ownerUserId, job.scope.childId, async b => {
        if (!same(job.scope, b.scope) || job.generation !== b.generation || job.authorizationVersion !== b.authorizationVersion) return { state: 'stopped' as const };
        const loaded = await load(b), history = await all(b), settings = await topics(b), now = new Date(), at = now.toISOString();
        const changes: Saved[] = [], jobs: Awaited<ReturnType<typeof prepareFirestoreBackgroundWork>>[] = [];
        const checks = [nextGrowthCheck(loaded.context, now), ...loaded.sources.map(source => source.validUntil ?? null)];
        for (const rule of GROWTH_RULES) {
          const saved = history.filter(value => value.item.topicId === rule.id), latest = saved.at(-1);
          const next = settings.find(value => value.topicId === rule.id)?.disabled ? undefined : loaded.proposals.find(value => value.topicId === rule.id);
          for (const previous of saved.filter(value => active(value.item))) {
            if (!next || !same(previous.item.basis, next.basis)) changes.push({ item: { ...previous.item, version: previous.item.version + 1,
              state: 'inapplicable', updatedAt: at, lastAction: 'basis_unavailable', actorUserId: null, note: '適用條件或已核對來源已改變。' }, lastRequest: null });
            else if (previous.item.state === 'snoozed' && previous.item.snoozeUntil) {
              if (Date.parse(previous.item.snoozeUntil) <= now.getTime()) changes.push({ item: { ...previous.item, version: previous.item.version + 1,
                state: 'proposed', snoozeUntil: null, updatedAt: at, lastAction: 'snooze_due', actorUserId: null }, lastRequest: null });
              else checks.push(previous.item.snoozeUntil);
            }
          }
          if (!next || saved.some(value => same(value.item.basis, next.basis)) || latest && !growthBasisChanged(latest.item.basis, next.basis)) continue;
          if (history.length + changes.filter(value => value.item.version === 1).length >= 500) domainReject('growth_history_requires_review', 400);
          const related = saved.toReversed().find(value => value.item.taskId && value.item.basis.stage === next.basis.stage)?.item.taskId;
          const linked = await task(b, related ?? null), reasons: string[] = [];
          if (latest) {
            if (latest.item.basis.stage !== next.basis.stage) reasons.push('孩子已進入此規則的新適用階段');
            if (latest.item.basis.ruleRevision !== next.basis.ruleRevision || latest.item.basis.sourceHash !== next.basis.sourceHash) reasons.push('官方依據或規則已重新核對並實質更新');
            for (const def of rule.inputs) if (next.basis.values[def.key] !== 'unknown' && next.basis.values[def.key] !== latest.item.basis.values[def.key]) reasons.push('新確認近況：' + def.label);
          }
          const item: GrowthAttention = { ...next, id: randomUUID(), childId: b.scope.childId, version: 1, state: 'proposed', createdAt: at, updatedAt: at,
            snoozeUntil: null, previousId: latest?.item.id ?? null, newReason: latest ? reasons.join('；') + '。舊事項的處理結果保留。' : '首次符合這項有限規則。',
            whyNow: next.whyNow + (linked ? ' 另有相關已確認任務，請先核對其實際狀態；沒有判定尚未安排。' : ''),
            taskId: linked?.id ?? null, taskState: linked?.occurrence.state ?? null, lastAction: 'proposed', actorUserId: null, note: '' };
          changes.push({ item, lastRequest: null });
          jobs.push(await prepareFirestoreBackgroundWork(data, b.transaction, { kind: 'growth', scope: b.scope, resourceId: item.id,
            basis: firestoreDomainHash(item.basis), generation: b.generation, authorizationVersion: b.authorizationVersion }, at));
        }
        if (changes.length > 16) domainReject('growth_history_requires_review', 400);
        const nextAt = checks.filter((value): value is string => !!value && Date.parse(value) > now.getTime()).sort((a, x) => Date.parse(a) - Date.parse(x))[0] ?? null;
        if (nextAt) jobs.push(await childWake(b, 'due:' + nextAt + ':' + GROWTH_CATALOG_REVISION, nextAt));
        const check = { childId: b.scope.childId, catalog: GROWTH_CATALOG_REVISION, at, nextAt,
          basis: firestoreDomainHash([loaded.context.profile, loaded.context.facts, loaded.sources.map(source => [source.chunkId, source.contentHash])]) };
        const change = changes.length ? await b.prepareChange(randomUUID(), 'growth', false) : null;
        const context = changes.length ? await prepareContextChange(data, b) : null;
        change?.commit(); context?.(); for (const saved of changes) write(b, saved); for (const job of jobs) job.commit();
        b.transaction.set(data.ref('growth_checks', 'growth-check', b.scope.childId), { ...data.tags(b.scope),
          ...data.seal('growth-check', b.scope.childId, b.scope, checkSchema, check) });
        return { state: 'completed' as const };
      });
    },
    backgroundInput: (job: FirestoreBackgroundWork) => authority.runTransaction(job.scope.ownerUserId, job.scope.childId, b => backgroundInputIn(b, job)),
    authorizeBackground: async (b: Binding, job: FirestoreBackgroundWork) => !!await backgroundInputIn(b, job),
    async taskAllowedIn(b: Binding, taskId: string) {
        const linked = (await all(b)).filter(value => value.item.taskId === taskId); if (!linked.length) return true;
        const loaded = await load(b), settings = await topics(b);
        for (const { item } of linked) if (settings.some(value => value.topicId === item.topicId && value.disabled)
          || ['dismissed', 'snoozed', 'inapplicable'].includes(item.state) || !(await visible(b, item, loaded)).sourceAvailable) return false;
        return true;
    },
    async taskAllowed(u: string, c: string, taskId: string): Promise<boolean> {
      return authority.runTransaction(u, c, b => store.taskAllowedIn(b, taskId));
    },
  };
  return store;
}
export type FirestoreGrowthStore = ReturnType<typeof createFirestoreGrowthStore>;

/** Existing persisted formats, shared with isolated recovery. */
export const firestoreGrowthRecoverySchema = checkSchema;
