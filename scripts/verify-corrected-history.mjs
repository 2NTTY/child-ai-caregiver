import assert from 'node:assert/strict';
import { createChatApi } from '../src/client/chat-api.ts';
import { createProductAgentApi } from '../src/client/product-agent-api.ts';
import { selectRecentConversation } from '../server/agent-context-window.ts';

/** Explicitly invoked only by the local emulator verifier. Seeding saves chat messages without invoking a model. */
export async function verifyCorrectedHistory({ origin, clientFetch, uid, createChild, freshSession, steps, onOriginal, onResult }) {
  const signal = AbortSignal.timeout(450_000);
  const getUser = async () => ({ id: uid, email: 'developer@local.yuyoufang.test', name: '本地開發帳號' });
  const initial = createChatApi(origin, getUser, clientFetch);
  const child = await createChild('簡介會查詢');
  const sibling = await createChild('其他簡介會');
  const old = await initial.saveMessage(child, '學校簡介會喺海星室', signal, uid);
  const correction = await initial.saveMessage(child, '改咗去青竹室', signal, uid);
  await initial.saveMessage(sibling, '學校簡介會喺木棉室', signal, uid);
  const earlier = [old, correction];
  for (const text of ['今日搭巴士。', '午飯食咗粟米。', '本圖書睇完啦。', '下午去咗公園。', '水樽洗好喇。', '件外套放咗喺椅背。']) {
    earlier.push(await initial.saveMessage(child, text, signal, uid));
  }
  await freshSession();
  const chat = createChatApi(origin, getUser, clientFetch);
  const question = await chat.saveMessage(child, '之前講嗰個學校簡介會，最後去邊間房？', signal, uid);
  const window = selectRecentConversation([...earlier, question], earlier.length);
  assert.ok(!window.messages.some(item => item.id === old.id || item.id === correction.id));
  steps.push('reopened-session-original-and-correction-outside-recent-window');
  await onOriginal({ childId: child, messageId: question.id, correctionId: correction.id });
  // Exactly one live POST. Look up its persisted run to evaluate the actual delivery.
  const reply = await chat.requestReply(child, question.id, signal, uid);
  const result = await createProductAgentApi(origin, clientFetch).getRun(child, reply.agentRunId, signal, uid);
  const tools = result.tools.map(({ name, status, reference }) => ({ name, status, reference }));
  const reviewedOriginal = result.deliveryReview?.sourceVersions.some(source => source.citationId.startsWith(`chat:${correction.id}:`)) ?? false;
  const evidence = { runId: result.runId, counts: result.counts, status: result.status, stopReason: result.stopReason, reviewedOriginal,
    questionId: question.id, correctionId: correction.id, tools, answeredCurrentRoom: reply.text.includes('青竹室'),
    disclosedSiblingRoom: reply.text.includes('木棉室'), proposedChanges: result.proposals.length,
    claimedUnrequestedWrite: /已.{0,10}(?:記錄|記低|保存).{0,16}(?:午餐|午飯|粟米)/u.test(reply.text) };
  onResult(evidence);
  assert.equal(result.status, 'completed', result.stopReason ?? 'Agent incomplete');
  assert.ok(evidence.answeredCurrentRoom, 'Missing corrected room in delivered answer');
  assert.equal(evidence.disclosedSiblingRoom, false);
  assert.equal(evidence.claimedUnrequestedWrite, false, 'Claimed an unrelated action on a read-only question');
  assert.equal(result.proposals.length, 0);
  const successful = tools.filter(tool => tool.status === 'succeeded');
  assert.ok(!successful.some(tool => /^(?:save|revise|create|update|delete|propose|confirm|schedule)_/u.test(tool.name)), 'Unexpected write on lookup');
  assert.ok(successful.some(tool => ['read_history', 'search_history'].includes(tool.name)), 'Missing successful history lookup');
  assert.ok(reviewedOriginal || successful.some(tool => tool.name === 'read_history' && tool.reference === correction.id),
    'Missing reviewed search excerpt or original history read for the correction');
  steps.push('delivered-corrected-room-with-source-no-sibling-or-writes');
  return evidence;
}
