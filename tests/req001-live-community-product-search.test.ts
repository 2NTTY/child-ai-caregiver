import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { FinishReason } from '@google/genai';
import ts from 'typescript';
import { AgentBudget } from '../server/agent-budget.ts';
import type { AgentRunContext } from '../server/agent-runtime.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreProductAgent } from '../server/firestore-product-agent.ts';
import { SOURCE_WATCHES } from '../server/knowledge-source-catalog.ts';
import { createLiveCommunityProductSearch, composeLiveSourceReaders, validateApprovedLiveUrl } from '../server/live-community-product-search.ts';
import { createOfficialLivePages } from '../server/official-live-pages.ts';
import { createProductAgentTools } from '../server/product-agent-tools.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { liveSourceCitationSchema, type LiveSourceCitation } from '../src/shared/live-source-citation.ts';
import { projectAgentRun, projectLiveCitation } from '../frontend/src/production/agent-projection.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

function htmlResponse(html: string, url: string, status = 200, contentType = 'text/html; charset=utf-8') {
  return {
    status: 'response' as const,
    response: { status, url, contentType, body: Buffer.from(html, 'utf8') },
  };
}

function makeTestRun(budget: AgentBudget): AgentRunContext {
  return {
    runId: crypto.randomUUID(),
    scope: {
      userId: 'synthetic-parent-live',
      workspaceId: 'synthetic-ws-live',
      childId: '11111111-1111-4111-8111-111111111111',
      authorizationVersion: '1',
      dataVersion: 'epoch:1',
    },
    budget,
  };
}

function makeToolsHarness(liveSourceReader: ReturnType<typeof createLiveCommunityProductSearch>, budget: AgentBudget) {
  const run = makeTestRun(budget);
  const knowledge = {
    createRun: () => ({
      search: async () => ({ mode: 'keyword_degraded' as const, degradationReason: 'embedding_unavailable' as const, chunks: [] }),
      readContext: async () => { throw new Error('unused'); },
      readReviewedCitations: async () => [],
      revalidateCitations: async () => true,
    }),
  } as unknown as Parameters<typeof createProductAgentTools>[0]['knowledge'];
  const memory = {
    context: async () => ({
      profile: { childId: run.scope.childId, version: 0, data: null },
      profileApplicable: false,
      facts: [],
      topics: [],
      summary: null,
      recentMessages: [],
      conflictingKeys: [],
      unavailableFactKeys: [],
      truncated: { facts: false, topics: false, messages: false },
    }),
    facts: async () => ({ items: [], nextAfterId: null }),
  } as unknown as Parameters<typeof createProductAgentTools>[0]['memory'];
  const tasks = { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) };
  const store = {
    readHistory: async () => [],
    confirmationQuestions: async () => [],
  } as unknown as Parameters<typeof createProductAgentTools>[0]['store'];

  return createProductAgentTools({
    run,
    memory,
    tasks,
    store,
    knowledge,
    liveSourceReader,
    authorize: async () => true,
    knownPrivateIdentifiers: ['張小寶'],
  });
}

test('approved allowlist, login/account path block, and zero snippet-as-original fallback on unreadable pages', async () => {
  const requestedUrls: string[] = [];
  const reader = createLiveCommunityProductSearch({
    now: () => new Date('2026-11-19T10:00:00Z'),
    discover: async () => [
      { url: 'https://unapproved.example.test/forum/1', title: '未核准網站', snippet: 'SHOULD_NEVER_BE_READ_UNAPPROVED' },
      { url: 'https://www.baby-kingdom.com/login.php?next=1', title: '會員登入', snippet: 'SHOULD_NEVER_BE_READ_LOGIN_URL' },
      { url: 'https://www.baby-kingdom.com/forum.php?mod=viewthread&tid=401', title: '需權限帖子', snippet: 'SNIPPET_403_FORBIDDEN' },
      { url: 'https://www.baby-kingdom.com/forum.php?mod=viewthread&tid=402', title: '登入牆帖子', snippet: 'SNIPPET_LOGIN_WALL' },
      { url: 'https://www.consumer.org.hk/tc/article/binary-pdf', title: '非HTML頁面', snippet: 'SNIPPET_NON_HTML' },
    ],
    transport: async (url, validate) => {
      validate(url);
      requestedUrls.push(url);
      if (url.includes('tid=401')) return htmlResponse('<html><body>Forbidden</body></html>', url, 403);
      if (url.includes('tid=402')) return htmlResponse('<html><head><title>請先登入 - 親子王國</title></head><body><main>請先登入會員後方可瀏覽全文。</main></body></html>', url, 200);
      return { status: 'response', response: { status: 200, url, contentType: 'application/pdf', body: Buffer.from('%PDF-1.7') } };
    },
  });

  assert.throws(() => validateApprovedLiveUrl('https://unapproved.example.test/page'), /unapproved_live_url/);
  assert.throws(() => validateApprovedLiveUrl('https://www.baby-kingdom.com/member/login'), /restricted_live_url/);

  const result = await reader.searchDetailed!('6個月 嬰兒奶粉', new AbortController().signal, 'recent_information');
  assert.equal(result.reads.length, 0);
  assert.deepEqual(requestedUrls, [
    'https://www.baby-kingdom.com/forum.php?mod=viewthread&tid=401',
    'https://www.baby-kingdom.com/forum.php?mod=viewthread&tid=402',
    'https://www.consumer.org.hk/tc/article/binary-pdf',
  ]);
  assert.deepEqual(result.limitations.map(item => item.reason), [
    'unapproved_host',
    'login_or_access_restricted',
    'login_or_access_restricted',
    'login_or_access_restricted',
    'original_unreadable',
  ]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('SNIPPET_'), false);
  assert.equal(serialized.includes('SHOULD_NEVER_BE_READ'), false);
});

test('outbound query minimization blocks identifiers before live discovery runs while passing minimized public query', async t => {
  let discoverCalls = 0;
  const seenQueries: string[] = [];
  const reader = createLiveCommunityProductSearch({
    knownPrivateIdentifiers: ['張小寶'],
    discover: async query => {
      discoverCalls += 1;
      seenQueries.push(query);
      return [];
    },
  });
  const signal = new AbortController().signal;
  for (const leaky of [
    '張小寶 6個月 奶粉',
    '2026-05-14 出生 尿片',
    '住沙田瀝源邨福海樓 嬰兒濕疹霜',
    '電話 91234567 兒童牙膏',
  ]) {
    await assert.rejects(() => reader.searchDetailed!(leaky, signal, 'recent_information'), /public_query_required/);
  }
  assert.equal(discoverCalls, 0);

  const budget = new AgentBudget();
  t.after(() => budget.close());
  const tools = makeToolsHarness(reader, budget);
  const searchTool = tools.tools.find(item => item.name === 'search_knowledge')!;
  const blocked = await searchTool.execute(
    { query: '家長：張小寶好唔好飲？\nuser：電話91234567', classification: 'recent_information', acquisition: 'live' },
    { scope: makeTestRun(budget).scope, runId: crypto.randomUUID(), callId: 'c1', signal },
  );
  assert.equal(blocked.status, 'rejected');
  assert.equal(blocked.data?.code, 'public_query_required');
  assert.equal(discoverCalls, 0);

  const ok = await searchTool.execute(
    { query: '6個月嬰兒 配方奶粉 1號 港版 評價 沙田區', classification: 'recent_information', acquisition: 'live' },
    { scope: makeTestRun(budget).scope, runId: crypto.randomUUID(), callId: 'c2', signal },
  );
  assert.equal(ok.status, 'succeeded');
  assert.equal(discoverCalls, 1);
  assert.deepEqual(seenQueries, ['6個月嬰兒 配方奶粉 1號 港版 評價 沙田區']);
});

test('extracts product specs, community cautions, conflicts, stale-only/promotional-only warnings without fabricating sourceDate', async () => {
  const reader = createLiveCommunityProductSearch({
    now: () => new Date('2026-11-19T12:00:00Z'),
    discover: async () => [
      { url: 'https://www.baby-kingdom.com/forum.php?mod=viewthread&tid=101' },
      { url: 'https://www.consumer.org.hk/tc/shopping-guide/formula-2024' },
      { url: 'https://www.baby-kingdom.com/forum.php?mod=viewthread&tid=102' },
    ],
    transport: async url => {
      if (url.includes('tid=101')) {
        return htmlResponse(`<html><body><main>
          <h1>家長討論：金裝奶粉 1號 港版 飲用分享</h1>
          <time datetime="2023-01-10T09:00:00Z">2023年1月10日</time>
          <article>我仔飲緊 型號：Gold-Stage1 港版 批次：B2301 HK$298，暫時便便正常、易溶，係合作試用優惠碼SHARE10分享。</article>
        </main></body></html>`, url);
      }
      if (url.includes('consumer.org.hk')) {
        return htmlResponse(`<html><body><main>
          <h1>測試比較：金裝奶粉 第1號 荷蘭版 成分摘要</h1>
          <article>消委會實測 型號：Gold-EU1 荷蘭版 批次：EU9981 HK$325，標籤說明與香港版營養標示略有差異。${'詳細檢測條目說明。'.repeat(70)}</article>
        </main></body></html>`, url);
      }
      return htmlResponse(`<html><body><main>
        <h1>另一家長帖：金裝奶粉 1號 港版</h1>
        <time datetime="2024-02-01T09:00:00Z">2024年2月1日</time>
        <article>我囡試過同款轉飲之後有少少便秘同紅疹，最後停用。</article>
      </main></body></html>`, url);
    },
  });

  const detailed = await reader.searchDetailed!('金裝奶粉 1號', new AbortController().signal, 'recent_information');
  assert.equal(detailed.reads.length, 3);
  const first = detailed.reads[0]!;
  assert.equal(first.sourceKind, 'community_discussion');
  assert.equal(first.sourceDate, '2023-01-10T09:00:00Z');
  assert.deepEqual(first.productSpec, {
    model: 'Gold-Stage1',
    variantOrStage: '1號',
    regionVersion: '港版',
    batchCode: 'B2301',
    priceText: 'HK$298',
  });
  assert.ok(first.cautions?.includes('self_reported_unverified'));
  assert.ok(first.cautions?.includes('suspected_promotional'));
  assert.ok(first.cautions?.includes('stale_source'));
  assert.ok(first.cautions?.includes('conflicting_claims'));

  const second = detailed.reads[1]!;
  assert.equal(second.sourceKind, 'product_spec');
  // Never fabricate sourceDate from fetchedAt when original page has no date.
  assert.equal(second.sourceDate, null);
  assert.equal(second.productSpec?.regionVersion, '荷蘭版');
  assert.ok(second.cautions?.includes('partial_read'));
  assert.ok(second.cautions?.includes('conflicting_claims'));
  assert.equal(second.cautions?.includes('stale_source'), false);
});

test('composeLiveSourceReaders merges official A-class live pages and C-class community/product search with partial failure tolerance', async () => {
  const visionWatch = SOURCE_WATCHES.find(item => item.id === 'fhs-child-vision')!;
  const officialReader = createOfficialLivePages({
    sourceIds: [visionWatch.id],
    mayRead: async () => true,
    fetchSource: async definition => ({
      status: 'ok',
      items: [{
        title: '學童視力檢查',
        text: '家長應留意兒童定期視力檢查安排。',
        url: definition.url,
        sourcePublishedAt: null,
        sourceUpdatedAt: null,
        sourceDateText: '2026年',
      }],
    }),
  });
  let bkAllowed = true;
  const communityReader = createLiveCommunityProductSearch({
    mayReadDomain: async id => id !== 'bk-public-forum' || bkAllowed,
    discover: async () => [{ url: 'https://www.baby-kingdom.com/forum.php?mod=viewthread&tid=555' }],
    transport: async url => htmlResponse('<html><body><main><h1>兒童眼鏡框討論</h1><article>不少家長比較眼鏡框鼻託防滑表現，個別感覺不同。</article></main></body></html>', url),
  });

  const composed = composeLiveSourceReaders(officialReader, communityReader);
  assert.deepEqual([...composed.classifications].sort(), ['official_guidance', 'recent_information']);

  const signal = new AbortController().signal;
  const officialHits = await composed.search('視力檢查', signal, 'official_guidance');
  assert.equal(officialHits.length, 1);
  assert.equal(officialHits[0]!.classification, 'official_guidance');

  const recentDetailed = await composed.searchDetailed!('兒童眼鏡框 防滑', signal, 'recent_information');
  assert.equal(recentDetailed.reads.length, 1);
  assert.equal(recentDetailed.reads[0]!.sourceKind, 'community_discussion');

  const { snapshotLiveRead } = await import('../server/live-source-citation.ts');
  const citation = snapshotLiveRead(recentDetailed.reads[0]!);
  assert.equal(await composed.mayUse(citation, signal), true);
  bkAllowed = false;
  assert.equal(await composed.mayUse(citation, signal), false);
});

test('search_knowledge live exposes locator-only limitations and rejects caregiving/unsupported claims on C-class live evidence', async t => {
  const budget = new AgentBudget();
  t.after(() => budget.close());
  const reader = createLiveCommunityProductSearch({
    discover: async () => [
      { url: 'https://www.baby-kingdom.com/forum.php?mod=viewthread&tid=700' },
      { url: 'https://www.consumer.org.hk/tc/article/missing-404' },
    ],
    transport: async url => {
      if (url.includes('missing-404')) return htmlResponse('<html><body>Not Found</body></html>', url, 404);
      return htmlResponse(
        '<html><body><main><h1>配方奶粉討論</h1><time datetime="2026-10-15T00:00:00Z">2026-10-15</time><article>家長自述：A牌 1號 港版 沖調後無明顯結塊，但另一個BB試飲後便便較硬。</article></main></body></html>',
        url,
      );
    },
  });
  const baseSearchDetailed = reader.searchDetailed!;
  reader.searchDetailed = async (q, sig, cls) => {
    const base = await baseSearchDetailed(q, sig, cls);
    return {
      ...base,
      reads: [
        ...base.reads,
        {
          documentId: 'bk-public-forum:locator-only',
          classification: 'recent_information',
          sourceKind: 'community_discussion',
          title: '僅限連結討論帖',
          publisher: '親子王國 Baby Kingdom',
          url: 'https://www.baby-kingdom.com/forum.php?mod=viewthread&tid=701',
          termsUrl: 'https://www.baby-kingdom.com/terms.php',
          fetchedAt: '2026-11-19T00:00:00Z',
          version: null,
          sourceDate: '2026-10-01',
          section: null,
          page: null,
          conditions: ['僅連結定位'],
          rights: 'locator_only',
          original: 'PRIVATE_UNRETAINED_TEXT',
          start: 0,
          end: 8,
        },
      ],
    };
  };

  const baseMayUse = reader.mayUse.bind(reader);
  reader.mayUse = async (citation, signal) => citation.rights === 'locator_only' ? true : baseMayUse(citation, signal);
  const tools = makeToolsHarness(reader, budget);
  const searchTool = tools.tools.find(item => item.name === 'search_knowledge')!;
  const presentTool = tools.tools.find(item => item.name === 'present_answer')!;
  const callCtx = { scope: makeTestRun(budget).scope, runId: crypto.randomUUID(), callId: 'c1', signal: new AbortController().signal };

  const searchRes = await searchTool.execute(
    { query: '配方奶粉 1號 港版', classification: 'recent_information', acquisition: 'live' },
    callCtx,
  );
  assert.equal(searchRes.status, 'succeeded');
  const data = searchRes.data as { result: { sources: LiveSourceCitation[]; limitations?: { reason: string }[] } };
  assert.equal(data.result.sources.length, 2);
  assert.equal(data.result.sources[1]!.excerpt, null);
  assert.ok(data.result.limitations?.some(item => item.reason === 'original_unreadable'));
  const citationId = data.result.sources[0]!.id;

  // Cannot use C-class recent_information live citation to back caregiving/safety_help guidance or cite locator-only unretained excerpt.
  const badCare = await presentTool.execute(
    { kind: 'caregiving', paragraphs: [{ text: '建議每天給嬰兒飲這款奶粉三次。', citationIds: [citationId] }] },
    callCtx,
  );
  assert.equal(badCare.status, 'rejected');
  assert.equal(badCare.data?.code, 'citation_required');
  const badSafety = await presentTool.execute(
    { kind: 'safety_help', paragraphs: [{ text: '急救指引以此討論為準。', citationIds: [citationId] }] },
    callCtx,
  );
  assert.equal(badSafety.status, 'rejected');
  assert.equal(badSafety.data?.code, 'citation_required');
  const badLocatorOnly = await presentTool.execute(
    { kind: 'public_information', paragraphs: [{ text: '嘗試引用只有連結的來源。', citationIds: [data.result.sources[1]!.id] }] },
    callCtx,
  );
  assert.equal(badLocatorOnly.status, 'rejected');
  assert.equal(badLocatorOnly.data?.code, 'citation_required');
});

test('validateLiveSourceClaims blocks fabricated stats, commercial endorsements, and verified-proof claims while allowing neutral comparisons', async t => {
  const budget = new AgentBudget();
  t.after(() => budget.close());
  const reader = createLiveCommunityProductSearch({
    discover: async () => [{ url: 'https://www.baby-kingdom.com/forum.php?mod=viewthread&tid=705' }],
    transport: async url => htmlResponse(
      '<html><body><main><h1>配方奶粉討論</h1><time datetime="2026-10-15T00:00:00Z">2026-10-15</time><article>家長自述：B牌 1號 港版 沖調後無明顯結塊，但另一位BB試飲後便便較硬。</article></main></body></html>',
      url,
    ),
  });
  const tools = makeToolsHarness(reader, budget);
  const searchTool = tools.tools.find(item => item.name === 'search_knowledge')!;
  const presentTool = tools.tools.find(item => item.name === 'present_answer')!;
  const callCtx = { scope: makeTestRun(budget).scope, runId: crypto.randomUUID(), callId: 'c-guard', signal: new AbortController().signal };

  const searchRes = await searchTool.execute(
    { query: 'B牌 1號 港版', classification: 'recent_information', acquisition: 'live' },
    callCtx,
  );
  assert.equal(searchRes.status, 'succeeded');
  const citationId = (searchRes.data as { result: { sources: LiveSourceCitation[] } }).result.sources[0]!.id;

  // 1) Rejects fabricated aggregate stats.
  const badStats = await presentTool.execute(
    { kind: 'public_information', paragraphs: [{ text: '整體家長滿意度極高，約85%家長表示這款奶粉最適合。', citationIds: [citationId] }] },
    callCtx,
  );
  assert.equal(badStats.status, 'rejected');
  assert.equal(badStats.data?.code, 'unsupported_live_claim');

  // 2) Rejects commercial sales recommendation.
  const badPromo = await presentTool.execute(
    { kind: 'public_information', paragraphs: [{ text: '總結這是最值得買的品牌，強烈推薦購買這一款。', citationIds: [citationId] }] },
    callCtx,
  );
  assert.equal(badPromo.status, 'rejected');
  assert.equal(badPromo.data?.code, 'unsupported_live_claim');

  // 3) Rejects fabricated verified-purchase / clinical proof claims.
  const badVerified = await presentTool.execute(
    { kind: 'public_information', paragraphs: [{ text: '論壇帖子已獲驗證真實使用並證實100%安全。', citationIds: [citationId] }] },
    callCtx,
  );
  assert.equal(badVerified.status, 'rejected');
  assert.equal(badVerified.data?.code, 'unsupported_live_claim');

  // 4) Accepts neutral qualitative comparison explicitly noting limitations / negated disclaimers.
  const neutral = await presentTool.execute(
    {
      kind: 'public_information',
      paragraphs: [{
        text: '根據公開討論帖的個別家長自述，B牌 1號 港版在部分使用記錄中沖調無明顯結塊，但另有個案反映便便較硬；上述有限帖子不代表整體家長滿意度或已驗證購買經驗，亦不構成購買推薦。',
        citationIds: [citationId],
      }],
    },
    callCtx,
  );
  assert.equal(neutral.status, 'succeeded');
});

test('REQ-001 C-class live search runs end-to-end through encrypted Firestore ProductAgent without persisting forum pages into library', async () => {
  const fake = firestoreDomainFixture();
  const options = {
    database: fake.database,
    cipher: createStorageCipher(Buffer.alloc(32, 19)),
    projectId: 'synthetic-live-c-project',
    namespace: 'synthetic_live_c',
  };
  const authority = createFirestoreAuthority(options);
  const user = 'synthetic-live-c-user';
  await authority.initializeControl({ generation: crypto.randomUUID(), enabled: true });
  const email = 'parent-c@example.test';
  await authority.issueInvitation({ email, expiresAt: new Date(Date.now() + 90_000).toISOString(), operationId: crypto.randomUUID() });
  await authority.admitIdentity({ userId: user, email, emailVerified: true });
  await authority.acknowledge({ userId: user, operationId: crypto.randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const { scope } = await authority.createChild({ userId: user, operationId: crypto.randomUUID(), displayName: 'SyntheticC' });

  const chat = createFirestoreChatStore(options);
  const care = createFirestoreCareStore(options);
  const memory = createFirestoreMemoryStore({ ...options, chat, care });
  const online = createFirestoreOnlineStore({ ...options, mutations: [chat.mutation, care.mutation, memory.mutation] });
  const message = await chat.createUserMessageForUser(user, scope.childId, '網上家長點評價 1號 港版配方奶粉同消委會資料？');
  assert.ok(message);

  const liveForumHtml = '<html><body><main><h1>家長討論：嬰兒 1號 港版配方奶粉用後感</h1><time datetime="2026-10-20T08:00:00Z">2026年10月20日</time><article>個別家長分享型號：SampleFormula-1 港版 HK$280 沖調較易溶，但亦有討論指口味偏甜。</article></main></body></html>';
  const liveCommunity = createLiveCommunityProductSearch({
    now: () => new Date('2026-11-19T12:00:00Z'),
    discover: async query => {
      assert.ok(!query.includes('SyntheticC'));
      return [
        { url: 'https://www.baby-kingdom.com/forum.php?mod=viewthread&tid=888' },
        { url: 'https://www.consumer.org.hk/tc/article/unavailable-guide' },
      ];
    },
    transport: async url => url.includes('tid=888')
      ? htmlResponse(liveForumHtml, url)
      : htmlResponse('<html><body>Forbidden</body></html>', url, 403),
  });

  let reviewCalls = 0;
  let capturedSourceId = '';
  const neutralAnswer = '根據公開家長討論帖的個別自述，SampleFormula-1（1號、港版，標價約 HK$280）有留言提到較易沖溶，亦有人指口味偏甜；另有一筆消委會條目因權限限制未能讀取原文。此整理僅供參考，不代表整體家長意見或商業推薦。';

  const product = await createFirestoreProductAgent({
    ...options,
    chat,
    care,
    memory,
    online,
    liveSourceReader: liveCommunity,
    config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: options.projectId }),
    platformProvider: {
      async generate(request) {
        const prompt = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? '').join('\n');
        const wrap = (parts: Record<string, unknown>[]) => ({
          content: { role: 'model', parts },
          finishReason: FinishReason.STOP,
          usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 8 },
        });
        if (prompt.includes('chat-delivery-review')) {
          reviewCalls += 1;
          const payload = JSON.parse(prompt.slice(prompt.indexOf('{')));
          assert.equal(payload.sources[0].citationId, capturedSourceId);
          return wrap([{ text: JSON.stringify({ draftHash: payload.draftHash, decision: 'pass', issues: [] }) }]);
        }
        const searchResp = request.contents
          .flatMap(content => content.parts ?? [])
          .find(part => part.functionResponse?.name === 'search_knowledge')?.functionResponse?.response as {
            status?: string;
            data?: { result?: { sources?: LiveSourceCitation[]; limitations?: { reason: string }[] } };
          } | undefined;
        if (!searchResp) {
          return wrap([{
            functionCall: {
              id: 'live-c-search',
              name: 'search_knowledge',
              args: { query: '嬰兒 1號 港版 配方奶粉 討論', classification: 'recent_information', acquisition: 'live' },
            },
          }]);
        }
        assert.equal(searchResp.status, 'succeeded');
        assert.equal(searchResp.data?.result?.sources?.length, 1);
        assert.ok(searchResp.data?.result?.limitations?.some(item => item.reason === 'login_or_access_restricted'));
        capturedSourceId = searchResp.data!.result!.sources![0]!.id;
        return wrap([{
          functionCall: {
            id: 'live-c-present',
            name: 'present_answer',
            args: { kind: 'public_information', paragraphs: [{ text: neutralAnswer, citationIds: [capturedSourceId] }] },
          },
        }]);
      },
    },
  });

  const reply = await product.agent.reply(user, scope.childId, message.id, async () => true);
  assert.ok(reply);
  assert.equal(reply.status, 'completed', JSON.stringify(reply));
  assert.equal(reviewCalls, 1);
  assert.equal(reply.liveCitations?.length, 1);
  assert.equal(reply.liveCitations![0]!.sourceKind, 'community_discussion');
  assert.equal(reply.liveCitations![0]!.productSpec?.regionVersion, '港版');
  assert.ok(reply.liveCitations![0]!.cautions?.includes('self_reported_unverified'));

  const view = projectAgentRun(reply, scope.childId, null);
  assert.equal(view.citations.length, 1);
  assert.equal(view.citations[0]!.acquisition, 'live');
  assert.equal(view.citations[0]!.liveSourceKind, 'community_discussion');
  assert.ok(view.citations[0]!.productSpecLabel?.includes('港版'));
  assert.ok(view.citations[0]!.cautionLabels?.some(label => label.includes('使用者自述')));

  // C-class on-demand live reads must NOT build a persistent forum/knowledge database.
  assert.equal([...fake.records.keys()].some(key => /_knowledge_|_library_preferences/.test(key)), false);
});

test('Frontend AnswerSources & CitationMarker distinguish live sources with non-color + moderate color cues while preserving two-step expansion', () => {
  const placeholder = new Proxy({}, { get: (_t, key) => String(key) });
  const node = (type: unknown, props: unknown) => ({ type, props });

  function createLoader(overrides: Record<string, any>) {
    const cache = new Map<string, any>();
    const load = (entry: string): any => {
      const file = path.resolve(root, entry);
      if (cache.has(file)) return cache.get(file).exports;
      const mod = { exports: {} };
      cache.set(file, mod);
      const code = ts.transpileModule(readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      }).outputText;
      new Function('require', 'module', 'exports', code)((name: string) => {
        if (Object.hasOwn(overrides, name)) return overrides[name];
        if (!name.startsWith('.')) return require(name);
        let target = path.resolve(path.dirname(file), name);
        if (!existsSync(target) && existsSync(target + '.ts')) target += '.ts';
        else if (!existsSync(target) && existsSync(target + '.tsx')) target += '.tsx';
        return load(target);
      }, mod, mod.exports);
      return mod.exports;
    };
    return load;
  }

  function renderCollectText(value: any): string {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(renderCollectText).join(' ');
    if (value && typeof value === 'object') {
      if (typeof value.type === 'function') return renderCollectText(value.type(value.props));
      const parts = [renderCollectText(value.props?.children)];
      for (const prop of ['title', 'byline', 'label', 'value', 'accessibilityLabel']) {
        if (typeof value.props?.[prop] === 'string') parts.push(value.props[prop]);
      }
      return parts.join(' ');
    }
    return '';
  }

  function renderCollectNodes(value: any, out: any[] = []): any[] {
    if (!value || typeof value !== 'object') return out;
    if (Array.isArray(value)) {
      for (const item of value) renderCollectNodes(item, out);
      return out;
    }
    if (typeof value.type === 'function') {
      return renderCollectNodes(value.type(value.props), out);
    }
    out.push(value);
    if (value.props?.children) renderCollectNodes(value.props.children, out);
    return out;
  }

  const realThemeColors = {
    ink: '#272343', deepTeal: '#272343', paper: '#FFFFFE', canvas: '#F7FCFC', sage: '#BAE8E8',
    line: '#CAC9D4', controlOutline: '#737284', quietSurface: '#EDFAF9', paleAmber: '#FFF7D8',
    statusWarmLine: '#A38B19', warningInk: '#5E4F0C',
  };

  const baseOverrides = (selectedId: string | null): Record<string, any> => ({
    react: {
      createContext: (def: unknown) => ({ _def: def, Provider: 'Provider' }),
      useContext: (ctx: any) => ctx._current ?? ctx._def ?? null,
      useId: () => 'synthetic-live',
      useLayoutEffect() {},
      useRef: (v: unknown) => ({ current: v ?? null }),
      useState: (initial: unknown) => {
        if (initial === null) return [selectedId, () => {}];
        return [initial, () => {}];
      },
      Fragment: 'Fragment',
    },
    'react/jsx-runtime': { jsx: node, jsxs: node, Fragment: 'Fragment' },
    'react-native': {
      Platform: { OS: 'web' },
      Pressable: 'Pressable',
      ScrollView: 'ScrollView',
      StyleSheet: { create: (v: unknown) => v },
      View: 'View',
      useWindowDimensions: () => ({ width: 1024, fontScale: 1 }),
      Linking: { openURL: async () => {} },
    },
    'react-native-paper': { Text: 'Text', ActivityIndicator: 'ActivityIndicator' },
    '../../preview/PreviewNavigationGuard': { PreviewLink: 'PreviewLink' },
    '../AppDialog': { AppDialog: Object.assign('AppDialog', { ScrollArea: 'ScrollArea', Actions: 'Actions' }) },
    '../memory/SourceDocumentCard': { SourceDocumentCard: 'SourceDocumentCard' },
    '../memory/PlatformCardJoin': { PlatformCardJoin: 'PlatformCardJoin' },
    '../AppScrollView': { AppScrollView: 'AppScrollView' },
    '../HorizontalOverflowRail': { HorizontalOverflowRail: 'HorizontalOverflowRail' },
    '../ui': { AppButton: 'AppButton' },
    '../AppIcon': { AppIcon: 'AppIcon' },
    '../StatusAnnouncement': { StatusAnnouncement: 'StatusAnnouncement' },
    '../../theme': { colors: realThemeColors, spacing: placeholder, chineseFont: 'synthetic' },
    '../../motion': { MotionDisclosure: ({ children }: any) => children, MotionEntrance: ({ children }: any) => children },
    '../../motion/MotionSelectionMarker': { MotionSelectionMarker: 'MotionSelectionMarker' },
    './locateCitationSource': { locateCitationSource() {} },
    './chat-presentation': { chatColors: placeholder, chatFont: 'synthetic', chatLayout: placeholder, chatType: placeholder },
  });

  const liveCitation: LiveSourceCitation = liveSourceCitationSchema.parse({
    id: crypto.randomUUID(),
    acquisition: 'live',
    classification: 'recent_information',
    sourceKind: 'community_discussion',
    documentId: 'bk-public-forum:abcd1234',
    title: '合成討論：1號 港版配方奶粉沖調體驗',
    publisher: '親子王國 Baby Kingdom',
    url: 'https://www.baby-kingdom.com/forum.php?mod=viewthread&tid=901',
    termsUrl: 'https://www.baby-kingdom.com/terms.php',
    fetchedAt: '2026-11-19T08:00:00Z',
    version: null,
    sourceDate: '2026-09-12',
    section: '嬰兒飲食版',
    page: null,
    conditions: ['家長社群自述，屬未經獨立核實之個別經驗'],
    productSpec: { model: 'Sample-1', regionVersion: '港版', priceText: 'HK$280' },
    cautions: ['self_reported_unverified', 'partial_read'],
    contentHash: 'a'.repeat(64),
    range: { start: 0, end: 18 },
    rights: 'retain_excerpt',
    excerpt: '家長自述：1號港版較易溶，未見結塊。',
  });
  const liveView = projectLiveCitation(liveCitation);
  const libView = {
    ...liveView,
    id: 'lib-official-1',
    sourceId: 'fhs-solid-food',
    seriesId: 'fhs-infant-feeding',
    acquisition: 'library' as const,
    classification: 'official_guidance' as const,
    title: '家庭健康服務官方指南',
    publisher: '衞生署',
    liveSourceKind: undefined,
    productSpecLabel: undefined,
    cautionLabels: undefined,
    cautions: undefined,
  };

  // The production official reader supplies the evidence class without an optional source kind.
  const officialLiveView = { ...libView, acquisition: 'live' as const, seriesId: undefined };
  for (const selectedId of [null, officialLiveView.id]) {
    const view = createLoader(baseOverrides(selectedId))('frontend/src/components/chat/AnswerSources.tsx').AnswerSources({
      sources: [officialLiveView], children: '官方原文【1】。',
    });
    const nodes = renderCollectNodes(view);
    if (selectedId === null) {
      const card = nodes.find(item => item.props?.testID === 'citation-card-1');
      assert.ok(card?.props.accessibilityLabel.includes('即時搜尋 · 官方指引'));
    } else {
      const detail = nodes.find(item => item.type === 'SourceDocumentCard');
      assert.ok(detail?.props.byline.includes('即時搜尋 · 官方指引'));
    }
  }

  // Test native & web CitationMarker non-color + moderate color cue.
  const nativeMarkerMod = createLoader(baseOverrides(null))('frontend/src/components/chat/CitationMarker.tsx');
  const nativeLiveTree = nativeMarkerMod.CitationMarker({ number: 1, label: '查看引用【1】（即時搜尋）', live: true, onPress() {} });
  const nativeLibTree = nativeMarkerMod.CitationMarker({ number: 2, label: '查看引用【2】', live: false, onPress() {} });
  assert.ok(renderCollectText(nativeLiveTree).includes('【1·即時】'));
  assert.ok(!renderCollectText(nativeLibTree).includes('即時'));

  const webMarkerMod = createLoader(baseOverrides(null))('frontend/src/components/chat/CitationMarker.web.tsx');
  const webLiveTree = webMarkerMod.CitationMarker({ number: 1, label: '查看引用【1】（即時搜尋）', live: true, onPress() {} });
  const webLibTree = webMarkerMod.CitationMarker({ number: 2, label: '查看引用【2】', live: false, onPress() {} });
  assert.ok(renderCollectText(webLiveTree).includes('【1·即時】'));
  assert.equal(webLiveTree.props.children.props.style.background, realThemeColors.paleAmber);
  assert.equal(webLibTree.props.children.props.style.background, 'transparent');

  // Test collapsed cards + expanded OriginalCard for uncatalogued live citation.
  const collapsedMod = createLoader(baseOverrides(null));
  const collapsedTree = collapsedMod('frontend/src/components/chat/AnswerSources.tsx').AnswerSources({
    sources: [liveView, libView],
    children: '社群參考【1】，官方參考【2】。',
  });
  const collapsedNodes = renderCollectNodes(collapsedTree);
  const badgeNodes = collapsedNodes.filter(item => typeof item.props?.testID === 'string' && item.props.testID.startsWith('live-source-badge-'));
  assert.equal(badgeNodes.length, 1);
  assert.equal(badgeNodes[0].props.testID, 'live-source-badge-1');
  const collapsedText = renderCollectText(collapsedTree);
  assert.ok(collapsedText.includes('即時搜尋 · 社群經驗'));
  const liveCard = collapsedNodes.find(item => item.props?.testID === 'citation-card-1');
  assert.ok(liveCard);
  const liveCardStyles = liveCard.props.style({ pressed: false });
  assert.ok(liveCardStyles.some((s: any) => s && s.backgroundColor === realThemeColors.paleAmber));

  const expandedMod = createLoader(baseOverrides(liveView.id));
  const expandedTree = expandedMod('frontend/src/components/chat/AnswerSources.tsx').AnswerSources({
    sources: [liveView, libView],
    children: '社群參考【1】。',
  });
  const expandedText = renderCollectText(expandedTree);
  assert.ok(expandedText.includes('親子王國 Baby Kingdom · 即時搜尋 · 社群經驗'));
  assert.ok(expandedText.includes('商品規格／型號'));
  assert.ok(expandedText.includes('版本：港版'));
  assert.ok(expandedText.includes('標示價格：HK$280'));
  assert.ok(expandedText.includes('使用者自述'));
  assert.ok(expandedText.includes('開啟現行網站'));
  assert.equal(expandedText.includes('查看來源庫'), false, 'Uncatalogued live source must not fabricate a persistent library link');
});
