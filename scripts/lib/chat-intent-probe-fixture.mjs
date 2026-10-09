import { FIXTURE_TEXT, fail, selectedUsage } from './chat-intent-probe-guards.mjs';

export const IDS = Object.freeze({ child: '1ebcb39d-a2db-4b8c-a432-7ffcb3de5808',
  run: 'd4a1b662-d13d-476b-bf52-40a28aa1a1a7', message: '7de5a0e8-e106-4485-b7d2-3b572741da39',
  taskA: '83a3109f-cdf2-46eb-a845-473802e0766f', taskB: 'ed132f95-5ebc-44e5-a84c-a262fa1dd8f6' });
const userId = 'synthetic-caregiver';
const cleanString = value => typeof value === 'string' ? value.slice(0, 12000) : null;
const select = (value, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(value ?? {}, key)).map(key => [key, value[key]]));
const taskKeys = ['id', 'childId', 'version', 'title', 'details', 'kind', 'assigneeUserId', 'createdBy', 'createdAt', 'updatedAt'];
export function selectTask(task) {
  return { ...select(task, taskKeys), occurrence: select(task.occurrence, ['id', 'dueAt', 'timeZone', 'state', 'terminalBasisVersion']) };
}
function selectArgs(name, args) {
  if (name === 'present_answer') return { kind: args?.kind,
    paragraphs: (Array.isArray(args?.paragraphs) ? args.paragraphs : []).slice(0, 6).map(item => ({ text: cleanString(item.text), citationIds: item.citationIds })) };
  const fields = { read_context: ['factsAfterId', 'topicsAfterId', 'tasksAfterId'], load_capabilities: ['capabilities'],
    propose_task_change: ['taskId', 'expectedVersion', 'action', 'note', 'dueAt', 'timeZone', 'assigneeUserId'],
    request_confirmation: ['runId', 'proposalId', 'expectedVersion', 'workId'], read_work: ['workId', 'cursor'] };
  return fields[name] ? select(args, fields[name]) : { omitted: true };
}
export function selectResponse(response, callIndex) {
  return { callIndex, finishReason: response.finishReason ?? null, usage: selectedUsage(response.usageMetadata),
    parts: (response.content?.parts ?? []).filter(part => !part.thought).flatMap(part => {
      if (part.functionCall) return [{ functionCall: { name: part.functionCall.name,
        args: selectArgs(part.functionCall.name, part.functionCall.args) } }];
      return typeof part.text === 'string' ? [{ text: cleanString(part.text) }] : [];
    }) };
}

// Uses real Runner/runtime/product tools/API. These stores are deliberately
// synthetic and cannot establish PG transaction or complete-service behavior.
export async function runFixture({ caseId, config, provider, ledger, bVisibleText, scriptedVariant = 'display', productModules }) {
  if (!['A', 'B', 'C'].includes(caseId) || caseId === 'C' && !bVisibleText) fail('case_c_requires_reviewed_b');
  // Main supplies only modules loaded after trusted/product-root preflight.
  // Offline unit tests use the local product copy without any true provider.
  const modules = productModules ?? {
    runtime: await import('../../server/agent-runtime.ts'), product: await import('../../server/product-agent.ts'),
    api: await import('../../server/product-agent-api.ts'), family: await import('../../server/family-access.ts'),
  };
  const { createAgentRuntime } = modules.runtime, { createProductAgent } = modules.product;
  const { handleProductAgentRequest } = modules.api, { FamilyError } = modules.family;
  const now = new Date().toISOString();
  const task = (id, title, occurrenceId) => ({ id, childId: IDS.child, version: 1, title, details: 'Synthetic fixture',
    kind: 'ordinary', assigneeUserId: userId, createdBy: userId, createdAt: now, updatedAt: now,
    occurrence: { id: occurrenceId, dueAt: new Date(Date.now() + 3600000).toISOString(), timeZone: 'Asia/Hong_Kong',
      state: 'scheduled', terminalBasisVersion: null } });
  const tasks = [task(IDS.taskA, '檢查替換衣物', '6b830f5b-886f-49c0-8b87-865580d61e19'),
    ...(caseId === 'A' ? [] : [task(IDS.taskB, '整理出門袋', 'f2d9a87f-34de-4fbc-a6d5-b8850edb3067')])];
  const messages = [{ role: 'user', text: FIXTURE_TEXT.list }, { role: 'model', text: caseId === 'A' ? FIXTURE_TEXT.listA : FIXTURE_TEXT.listB },
    { role: 'user', text: FIXTURE_TEXT.ambiguous },
    ...(caseId === 'C' ? [{ role: 'model', text: bVisibleText }, { role: 'user', text: FIXTURE_TEXT.clarified }] : [])]
    .map((item, index, array) => ({ ...item, id: index === array.length - 1 ? IDS.message : `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      childId: IDS.child, authorUserId: item.role === 'user' ? userId : null, createdAt: now, inReplyTo: null }));
  const context = { profile: { childId: IDS.child, version: 0, data: null }, profileApplicable: false,
    facts: [], topics: [], summary: null, recentMessages: messages, conflictingKeys: [], unavailableFactKeys: [],
    truncated: { facts: false, topics: false, messages: false } };
  const scope = { userId, childId: IDS.child, workspaceId: 'synthetic-workspace', authorizationVersion: '1', dataVersion: 'epoch:1' };
  const counters = { proposalAttempts: 0, proposalWrites: 0, taskWrites: 0, confirmationWrites: 0,
    otherBusinessWrites: 0, resultPersistenceWrites: 0, displayPersistenceWrites: 0, embeddingCalls: 0 };
  const proposals = [], confirmations = [], providerResponses = [], contextResponses = [], seenContexts = new Set();
  const modelMessages = []; let saved = null, claimed = false, calls = 0;
  const mutationDenied = async () => { counters.otherBusinessWrites++; throw new FamilyError(400, 'synthetic_operation_unsupported'); };
  const store = {
    claim: async () => { const created = !claimed; claimed = true; return { runId: IDS.run, scope, created, state: 'running', expiresAt: new Date(Date.now() + 90000).toISOString() }; },
    authorize: async () => true, consumeConfirmation: async () => null,
    propose: async (_scope, runId, _callId, value) => {
      counters.proposalAttempts++;
      if (runId !== IDS.run || value.kind !== 'task_change') throw new FamilyError(400, 'synthetic_operation_unsupported');
      const target = tasks.find(item => item.id === value.taskId);
      if (!target || target.version !== value.change.expectedVersion) throw new FamilyError(409, 'version_conflict');
      const existing = proposals.find(item => JSON.stringify(item.value) === JSON.stringify(value));
      if (existing) return existing;
      counters.proposalWrites++;
      const proposal = { id: `20000000-0000-4000-8000-${String(proposals.length).padStart(12, '0')}`, runId, childId: IDS.child,
        version: 1, status: 'pending', createdAt: now, expiresAt: new Date(Date.now() + 86400000).toISOString(),
        value: structuredClone(value), result: null, targetLabel: target.title };
      proposals.push(proposal); return proposal;
    },
    requestConfirmation: async (_scope, _runId, input) => {
      const proposal = proposals.find(item => item.id === input.proposalId && input.runId === item.runId && input.expectedVersion === item.version);
      if (!proposal) throw new FamilyError(409, 'version_conflict');
      counters.confirmationWrites++;
      const confirmation = { id: '63b3f13a-e1af-4ad7-b9fa-fb349c8b9c7f', proposalRunId: IDS.run,
        proposalId: proposal.id, proposalVersion: 1, expiresAt: new Date(Date.now() + 86400000).toISOString(),
        question: `合成待確認：${proposal.targetLabel}。尚未執行。` };
      confirmations.push(confirmation); return confirmation;
    },
    confirmationQuestions: async () => confirmations.map(item => item.question), bindConfirmationQuestion: async () => true,
    readWork: async () => ({ items: [], nextCursor: null, complete: true }),
    searchHistory: async () => ({ items: [], nextCursor: null, complete: true }),
    readHistory: async (_user, _child, input) => {
      const message = messages.find(item => item.id === input.messageId);
      if (!message) return null;
      const text = message.text.slice(input.offset, input.offset + input.limit), end = input.offset + text.length;
      return { message: { ...message, text }, offset: input.offset, totalCharacters: message.text.length,
        complete: end === message.text.length, nextOffset: end < message.text.length ? end : null };
    },
    saveWork: mutationDenied,
    finish: async (_scope, result, summary) => { counters.resultPersistenceWrites++; if (summary) counters.otherBusinessWrites++;
      saved = { ...result, proposals: structuredClone(proposals) }; return true; },
    get: async () => saved,
  };
  const chat = { listForUser: async () => ({ messages: [...messages, ...modelMessages] }),
    createModelMessageForUser: async (_user, _child, replyTo, text) => { counters.displayPersistenceWrites++;
      const message = { id: '06a6334c-343d-4934-9dcf-5ceaa7707731', childId: IDS.child,
        authorUserId: null, role: 'model', text, createdAt: now, inReplyTo: replyTo };
      modelMessages.push(message); return message; } };
  const script = async () => {
    const index = calls - 1;
    const functionCall = (name, args = {}) => ({ name, args, id: `offline-${index}-${name}` });
    const presentation = functionCall('present_answer', { kind: caseId === 'B' ? 'clarification' : 'operation',
      paragraphs: [{ text: 'Synthetic display boundary test.', citationIds: [] }] });
    let batch;
    if (index === 0) batch = [functionCall('read_context'), functionCall('load_capabilities', { capabilities: ['tasks'] })];
    else if (index === 1 && (caseId !== 'B' || scriptedVariant !== 'display')) batch = [functionCall('propose_task_change', {
      taskId: caseId === 'C' ? IDS.taskB : IDS.taskA, expectedVersion: scriptedVariant === 'rejected_proposal' ? 2 : 1,
      action: 'complete', note: FIXTURE_TEXT.ambiguous, dueAt: null, timeZone: null, assigneeUserId: null })];
    else if (index <= 2) batch = [presentation];
    else fail('offline_script_exhausted');
    return { content: { role: 'model', parts: batch.map(call => ({ functionCall: call })) }, finishReason: 'STOP',
      usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3, totalTokenCount: 11 } };
  };
  const runtime = createAgentRuntime({ config,
    usage: { reserve: async () => ledger.reserve(), record: async record => ledger.outcome(record.outcome) },
    provider: { generate: async (request, signal) => {
      calls++;
      for (const content of request.contents) for (const part of content.parts ?? []) {
        const response = part.functionResponse;
        if (response?.name !== 'read_context' || seenContexts.has(response.id)) continue;
        seenContexts.add(response.id); const result = response.response?.data?.result;
        contextResponses.push({ callIndex: calls, status: response.response?.status ?? null,
          ...(result ? { tasks: (result.tasks ?? []).map(selectTask),
            ...select(result, ['tasksHaveMore', 'nextTasksAfterId', 'eligibleAssigneesPartial', 'factsPartial', 'nextFactsAfterId',
              'topicsPartial', 'nextTopicsAfterId', 'earlierMessagesNotFullySummarized', 'summaryOmittedForCapacity']),
            uncoveredConversation: result.uncoveredConversation ? select(result.uncoveredConversation,
              ['complete', 'moreUncovered', 'omittedFromLoadedBatch', 'lastIncludedMessageId']) : null } : {}) });
      }
      try {
        const response = await (provider ? provider.generate(request, signal) : script());
        ledger.response(response.usageMetadata); providerResponses.push(selectResponse(response, calls)); return response;
      } catch (error) { ledger.unknown('provider_or_response_unknown'); throw error; }
    } } });
  const service = createProductAgent({ runtime, store, chat,
    memory: { context: async () => structuredClone(context), prepareSummary: async () => null,
      getFact: async () => null, facts: async () => ({ items: [], nextAfterId: null }) },
    tasks: { list: async () => ({ items: structuredClone(tasks), eligibleAssignees: [{ userId, name: 'Synthetic caregiver' }], nextAfterId: null }),
      change: async () => { counters.taskWrites++; throw new FamilyError(400, 'synthetic_task_write_forbidden'); },
      create: async () => { counters.taskWrites++; throw new FamilyError(400, 'synthetic_task_write_forbidden'); } },
    knowledge: { createRun: () => ({ search: async () => ({ mode: 'keyword_degraded', chunks: [] }),
      revalidateCitations: async () => true, readContext: async () => ({ chunks: [], complete: true, hasMore: false }) }) },
  });
  const response = await handleProductAgentRequest(new Request(`https://synthetic.invalid/api/children/${IDS.child}/messages/${IDS.message}/reply`,
    { method: 'POST', headers: { 'content-type': 'application/json', 'x-expected-user-id': userId }, body: '{}' }), userId,
    { agent: service, store, chat, isCurrentUser: async () => true });
  const payload = await response.json();
  const visibleText = payload.message?.text ?? '';
  const target = caseId === 'C' ? IDS.taskB : IDS.taskA;
  const mutationToolNames = /^(?:propose_|request_confirmation$|save_|change_|create_|revise_|generate_|contact_)/u;
  const attemptedMutationCalls = providerResponses.flatMap(item => item.parts).filter(item => item.functionCall && mutationToolNames.test(item.functionCall.name));
  const persistedDomainWrites = counters.taskWrites + counters.otherBusinessWrites + counters.confirmationWrites;
  const zeroTaskEffects = counters.taskWrites === 0 && tasks.every(item => item.version === 1 && item.occurrence.state === 'scheduled');
  const mechanicallyPassed = saved?.status === 'completed' && response.status === 200 && saved.counts.queryEmbeddings === 0 && zeroTaskEffects
    && (caseId === 'B' ? proposals.length === 0 && counters.proposalAttempts === 0 && persistedDomainWrites === 0 && attemptedMutationCalls.length === 0
      : proposals.length === 1 && proposals[0].status === 'pending' && proposals[0].result === null
        && proposals[0].value.kind === 'task_change' && proposals[0].value.taskId === target && proposals[0].value.change.action === 'complete');
  return { syntheticConversation: messages.map(({ role, text }) => ({ role, text })),
    taskInitialAndFinal: tasks.map(selectTask), actualReadContextResponses: contextResponses, providerResponses,
    result: { httpStatus: response.status, status: saved?.status ?? null, stopReason: saved?.stopReason ?? null,
      visibleText, modelRenderedText: saved?.text ?? '', counts: saved?.counts ?? null,
      tools: saved?.tools.map(item => select(item, ['name', 'status'])) ?? [],
      proposals: proposals.map(item => select(item, ['id', 'status', 'version', 'value', 'result', 'targetLabel'])) },
    syntheticStateCounters: counters,
    mechanical: { status: mechanicallyPassed ? 'passed' : 'failed', attemptedMutationCalls: attemptedMutationCalls.length,
      taskEffectsAbsent: zeroTaskEffects, targetPendingOnly: caseId === 'B' ? null : mechanicallyPassed },
    semantic: { status: 'root_review_required', note: 'No natural-language pass decision is made by this script. Scripted offline responses do not test LLM semantics.' },
    runtimeObserved: { providerCalls: calls, embeddings: 0 },
  };
}
