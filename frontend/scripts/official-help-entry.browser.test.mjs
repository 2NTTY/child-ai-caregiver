import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';

const DIST_DIR = path.resolve(import.meta.dirname, '..', 'dist');
const USER_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const EPOCH_ID = '33333333-3333-4333-8333-333333333333';
const CHILD_1_ID = '44444444-4444-4444-8444-444444444441';
const CHILD_2_ID = '44444444-4444-4444-8444-444444444442';

const BELL_LABEL = '開啟最近消息';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

function startStaticDistServer() {
  if (!fs.existsSync(path.join(DIST_DIR, 'chat.html'))) {
    throw new Error(`Missing Expo Web export under ${DIST_DIR}. Run "npm run build:web --workspace frontend" first.`);
  }
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = new URL(req.url || '/', 'http://127.0.0.1').pathname;
      const normalized = path.posix.normalize(urlPath).replace(/^\/+/, '');
      const candidates = [
        path.join(DIST_DIR, normalized),
        path.join(DIST_DIR, normalized ? `${normalized}.html` : 'index.html'),
        path.join(DIST_DIR, normalized, 'index.html'),
      ];
      let target = null;
      for (const candidate of candidates) {
        if (!candidate.startsWith(DIST_DIR)) continue;
        try {
          const st = await fsp.stat(candidate);
          if (st.isFile()) { target = candidate; break; }
        } catch {}
      }
      if (!target) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      const ext = path.extname(target).toLowerCase();
      res.setHeader('Content-Type', MIME_TYPES[ext] ?? 'application/octet-stream');
      res.end(await fsp.readFile(target));
    } catch {
      res.statusCode = 500;
      res.end('Server error');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise(done => server.close(done)),
      });
    });
  });
}

function createSyntheticBackend({ hasChildren = true, failReplyWithHelpCard = false, failReplyWithSourcesOnly = false, failBeforeRead = false, completeWithCitation = false, replyDelayMs = 0 } = {}) {
  const child1 = { id: CHILD_1_ID, workspaceId: WORKSPACE_ID, displayName: '小昕', createdAt: '2026-11-01T00:00:00.000Z', accessRole: 'owner' };
  const child2 = { id: CHILD_2_ID, workspaceId: WORKSPACE_ID, displayName: '阿樂', createdAt: '2026-11-01T00:00:00.000Z', accessRole: 'owner' };
  const messagesByChild = { [CHILD_1_ID]: [], [CHILD_2_ID]: [] };
  const replyStateByMsg = new Map();
  const runDetailsById = new Map();
  let nextSeq = 1;
  let unroutedApi = [];
  let completeOnReload = false;
  let revokeAccessOnNextRead = false;
  let failNextMessageRead = false;

  const syntheticCitation = {
    chunkId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sourceId: 'fhs-solid-food',
    versionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    versionHash: 'a'.repeat(64),
    contentHash: 'b'.repeat(64),
    key: 'starting-solids',
    section: '引進固體食物的時間與質感',
    sourceExcerpt: '未足四個月大的寶寶不應吃奶以外的食物',
    text: '衞生署家庭健康服務指出，孩子約六個月時應開始加入固體食物。',
    keywords: ['加固'],
    applicability: { region: 'HK', ageBasis: 'actual', minAgeMonths: 0, maxAgeMonths: 12, topics: ['feeding'], conditions: [] },
    url: 'https://www.fhs.gov.hk/tc_chi/health_info/child/30039.html',
    title: '嬰幼兒飲食－引進固體食物過渡期',
    publisher: '香港特別行政區政府衞生署家庭健康服務',
    classification: 'official_guidance',
    sourcePublishedAt: null,
    sourceUpdatedAt: null,
    sourceDateText: '02/2026 修訂',
    validUntil: null,
    fetchedAt: '2026-10-07T21:28:06.298Z',
    checkedAt: '2026-10-07T21:28:06.298Z',
    reviewState: 'reviewed',
    applicabilityStatus: 'applicable',
  };
  const syntheticProgressSource = (stage) => ({
    chunkId: syntheticCitation.chunkId,
    sourceId: syntheticCitation.sourceId,
    title: syntheticCitation.title,
    section: syntheticCitation.section,
    publisher: syntheticCitation.publisher,
    url: syntheticCitation.url,
    excerpt: syntheticCitation.sourceExcerpt,
    fetchedAt: syntheticCitation.fetchedAt,
    sourceUpdatedAt: null,
    sourceDateText: syntheticCitation.sourceDateText,
    stage,
  });

  const profileFor = childId => ({
    profile: {
      childId, version: 1,
      data: { age: { kind: 'approximate', rawValue: '2', unit: 'years', asOf: '2026-11-01' }, dueDate: null, gestationalWeeksRaw: null, region: 'HK', language: 'zh-HK', allergies: null, specialNeeds: null, preferences: null, source: 'parent', validUntil: null },
      confirmedBy: USER_ID, confirmedAt: '2026-11-01T00:00:00.000Z', reason: 'init', confirmationBasis: 'explicit',
    },
  });

  async function install(context, baseUrl) {
    await context.route('**/*', async route => {
      const req = route.request();
      const url = new URL(req.url());
      if (['data:', 'blob:', 'about:'].includes(url.protocol)) { await route.continue(); return; }
      if (url.origin !== baseUrl) {
        // Some Windows installations inject this script into localhost pages.
        if (url.hostname.endsWith('.scr.kaspersky-labs.com') && req.resourceType() === 'script') {
          await route.fulfill({ contentType: 'application/javascript', body: '' });
          return;
        }
        await route.abort('blockedbyclient');
        return;
      }
      if (!url.pathname.startsWith('/api/')) {
        await route.continue();
        return;
      }

      const json = (status, body) => route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
      const p = url.pathname;
      const m = req.method();

      if (p === '/api/auth/get-session') return json(200, { user: { id: USER_ID, name: '家長測試', email: 'parent@synthetic.invalid' } });
      if (p === '/api/account') {
        return json(200, {
          enabled: true, registration: 'invite', mailConfigured: false, policyVersion: '2026-10-08',
          notice: 'Synthetic E2E notice',
          user: { id: USER_ID, emailVerified: true, acknowledged: true, acknowledgementVersion: '2026-10-08' },
        });
      }
      if (p === '/api/children' && m === 'GET') {
        return json(200, { children: hasChildren ? [child1, child2] : [], nextCursor: null });
      }
      if (p === '/api/ai/status') return json(200, { available: true });
      if (p === '/api/ai/usage') return json(200, { day: '2026-11-18', attempts: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, unknownUsageAttempts: 0 });
      if (p === '/api/ai/settings/models') {
        return json(200, {
          version: 1, provider: 'gemini', scope: 'model_metadata_only', status: 'not_checked', truncated: false,
          embedding: { model: 'gemini-embedding-001', dimensions: 1024, status: 'not_checked' },
          models: [],
        });
      }
      if (p === '/api/ai/settings') {
        const usageObj = { day: '2026-11-18', attempts: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, unknownUsageAttempts: 0 };
        return json(200, {
          settings: { version: 1, mode: 'platform', provider: 'gemini', model: 'gemini-2.5-flash', keyConfigured: false, backgroundEnabled: false, dailyLimit: 50, maxModelCalls: 4, maxQueryEmbeddings: 2, updatedAt: null },
          enabled: true, platformAvailable: true, personalAvailable: false, personalGlobalLimit: 100,
          usage: { platform: { ...usageObj, billingSource: 'platform' }, personal: { ...usageObj, billingSource: 'personal' } },
        });
      }
      if (p === '/api/web-push') {
        return json(200, { userId: USER_ID, available: false, workerEnabled: false, publicKey: null, supportedProviders: ['fcm'], bindings: [], deliveries: [], testsRemaining: 3, nextTestAt: null });
      }
      if (p === '/api/telegram') {
        return json(200, { configured: false, workerEnabled: false, botUsername: null, binding: null, challenge: null, deliveries: [] });
      }
      if (p === '/api/notification-preferences') {
        return json(200, { timeZone: 'Asia/Hong_Kong', quietStart: '22:00', quietEnd: '07:00', allowAppointmentDuringQuiet: false, version: 0 });
      }
      if (p === '/api/online/spaces') return json(200, { workspaces: [{ id: WORKSPACE_ID, storageEpoch: EPOCH_ID }] });
      if (p === '/api/online/changes') {
        return json(200, { workspaceId: WORKSPACE_ID, storageEpoch: EPOCH_ID, cursor: '0', accessVersion: 1, changes: [], hasMore: false });
      }
      if (p === '/api/online/context') return json(200, { workspaceId: WORKSPACE_ID, storageEpoch: EPOCH_ID });
      if (p.startsWith('/api/online/operations/')) return json(200, { state: 'unconfirmed' });
      if (p === '/api/online/submit' && m === 'POST') {
        const sub = req.postDataJSON();
        const match = /^\/api\/children\/([^/]+)\/messages$/u.exec(sub.path);
        if (match) {
          const cid = decodeURIComponent(match[1]);
          const msg = {
            id: `55555555-5555-4555-8555-${String(nextSeq++).padStart(12, '0')}`,
            childId: cid, authorUserId: USER_ID, role: 'user',
            text: sub.payload.text, inReplyTo: null, createdAt: new Date().toISOString(),
          };
          messagesByChild[cid] = [...(messagesByChild[cid] ?? []), msg];
          return json(200, { state: 'confirmed', operation: sub.operation, changeSeq: String(nextSeq), statusCode: 200, result: { message: msg } });
        }
      }

      const replyMatch = /^\/api\/children\/([^/]+)\/messages\/([^/]+)\/reply$/u.exec(p);
      if (replyMatch) {
        const cid = decodeURIComponent(replyMatch[1]);
        const msgId = decodeURIComponent(replyMatch[2]);
        if (revokeAccessOnNextRead) {
          revokeAccessOnNextRead = false;
          return json(403, { error: { code: 'not_found' } });
        }
        if (m === 'GET') {
          return json(200, { reply: replyStateByMsg.get(msgId) ?? null });
        }
        if (m === 'POST') {
          if (replyDelayMs > 0) await new Promise(done => setTimeout(done, replyDelayMs));
          const runId = `66666666-6666-4666-8666-${String(nextSeq++).padStart(12, '0')}`;
          if (failReplyWithHelpCard || failReplyWithSourcesOnly) {
            replyStateByMsg.set(msgId, { messageId: msgId, runId, status: 'stopped', stopReason: 'error' });
            runDetailsById.set(runId, {
              provenance: { packVersion: '0.1.60', recipeId: 'product-interactive', model: 'gemini-2.5-flash' },
              runId, status: 'stopped', stopReason: 'error', text: '',
              citations: [], retrievalMode: 'vector_keyword',
              tools: [{ name: 'search_knowledge', status: 'succeeded' }],
              counts: { modelCalls: 2, toolCalls: 1, queryEmbeddings: 1 }, proposals: [],
            });
            const sse = failReplyWithSourcesOnly
              ? [
                `data: ${JSON.stringify({ type: 'progress', progress: { runId, messageId: msgId, sequence: 1, phase: 'searching', sources: [syntheticProgressSource('found')] } })}\n\n`,
                ...(failBeforeRead ? [] : [
                  `data: ${JSON.stringify({ type: 'progress', progress: { runId, messageId: msgId, sequence: 2, phase: 'reading', sources: [syntheticProgressSource('read')] } })}\n\n`,
                  `data: ${JSON.stringify({ type: 'progress', progress: { runId, messageId: msgId, sequence: 3, phase: 'reviewing' } })}\n\n`,
                ]),
                `data: ${JSON.stringify({ type: 'result', status: 503, body: { error: { code: 'ai_unavailable' } } })}\n\n`,
              ].join('')
              : [
                `data: ${JSON.stringify({ type: 'progress', progress: { runId, messageId: msgId, phase: 'help', card: 'emergency-hk-v1' } })}\n\n`,
                `data: ${JSON.stringify({ type: 'result', status: 503, body: { error: { code: 'ai_unavailable' } } })}\n\n`,
              ].join('');
            return route.fulfill({ status: 200, contentType: 'text/event-stream; charset=utf-8', body: sse });
          }
          const replyText = completeWithCitation
            ? '根據衞生署指引，約六個月大可開始引入固體食物。【1】'
            : '已完成回覆。';
          replyStateByMsg.set(msgId, { messageId: msgId, runId, status: 'completed', stopReason: null });
          runDetailsById.set(runId, {
            provenance: { packVersion: '0.1.60', recipeId: 'product-interactive', model: 'gemini-2.5-flash' },
            runId, status: 'completed', stopReason: null, text: replyText,
            citations: completeWithCitation ? [syntheticCitation] : [],
            retrievalMode: completeWithCitation ? 'vector_keyword' : 'not_used',
            tools: completeWithCitation
              ? [{ name: 'search_knowledge', status: 'succeeded' }, { name: 'present_answer', status: 'succeeded' }]
              : [{ name: 'present_answer', status: 'succeeded' }],
            counts: { modelCalls: 2, toolCalls: completeWithCitation ? 2 : 1, queryEmbeddings: completeWithCitation ? 1 : 0 },
            proposals: [],
          });
          const modelMsg = {
            id: `77777777-7777-4777-8777-${String(nextSeq++).padStart(12, '0')}`,
            childId: cid, authorUserId: null, role: 'model', agentRunId: runId,
            text: replyText, inReplyTo: msgId, createdAt: new Date().toISOString(),
          };
          messagesByChild[cid] = [...(messagesByChild[cid] ?? []), modelMsg];
          const sse = completeWithCitation
            ? [
              `data: ${JSON.stringify({ type: 'progress', progress: { runId, messageId: msgId, sequence: 1, phase: 'searching', sources: [syntheticProgressSource('found')] } })}\n\n`,
              `data: ${JSON.stringify({ type: 'progress', progress: { runId, messageId: msgId, sequence: 2, phase: 'reading', sources: [syntheticProgressSource('read')] } })}\n\n`,
              `data: ${JSON.stringify({ type: 'progress', progress: { runId, messageId: msgId, sequence: 3, phase: 'reviewing' } })}\n\n`,
              `data: ${JSON.stringify({ type: 'result', status: 200, body: { message: modelMsg } })}\n\n`,
            ].join('')
            : `data: ${JSON.stringify({ type: 'result', status: 200, body: { message: modelMsg } })}\n\n`;
          return route.fulfill({ status: 200, contentType: 'text/event-stream; charset=utf-8', body: sse });
        }
      }

      const childMatch = /^\/api\/children\/([^/]+)\/(.+)$/u.exec(p);
      if (childMatch) {
        const cid = decodeURIComponent(childMatch[1]);
        const sub = childMatch[2];
        if (sub === 'profile') return json(200, profileFor(cid));
        if (sub === 'records') return json(200, { records: [], limit: 50 });
        if (sub === 'care/search') return json(200, { records: [], nextCursor: null, scanned: 1, limit: 50 });
        if (sub === 'agent/pending') return json(200, { proposals: [], nextCursor: null });
        if (sub === 'agent/runs') return json(200, { runs: [] });
        if (sub === 'agent/actions') return json(200, { receipts: [] });
        if (sub === 'agent/work') return json(200, { items: [], nextCursor: null, complete: true });
        if (sub === 'library') return json(200, { items: [], nextCursor: null, complete: true });
        if (sub.startsWith('agent/runs/')) {
          const rid = sub.slice('agent/runs/'.length);
          const stored = runDetailsById.get(rid);
          return json(200, {
            result: stored ?? {
              provenance: { packVersion: '0.1.60', recipeId: 'product-interactive', model: 'gemini-2.5-flash' },
              runId: rid, status: 'stopped', stopReason: 'error', text: '', citations: [], retrievalMode: 'not_used',
              tools: [], counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, proposals: [],
            },
          });
        }
        if (sub === 'messages') {
          if (failNextMessageRead) {
            failNextMessageRead = false;
            return json(503, { error: { code: 'temporarily_unavailable' } });
          }
          if (revokeAccessOnNextRead) {
            revokeAccessOnNextRead = false;
            return json(403, { error: { code: 'not_found' } });
          }
          if (completeOnReload && cid === CHILD_1_ID && messagesByChild[cid]?.length === 1) {
            const u = messagesByChild[cid][0];
            const prevState = replyStateByMsg.get(u.id);
            const runId = prevState?.runId ?? '66666666-6666-4666-8666-999999999999';
            const replyText = '已完成回覆。';
            replyStateByMsg.set(u.id, { messageId: u.id, runId, status: 'completed', stopReason: null });
            runDetailsById.set(runId, {
              provenance: { packVersion: '0.1.60', recipeId: 'product-interactive', model: 'gemini-2.5-flash' },
              runId, status: 'completed', stopReason: null, text: replyText, citations: [], retrievalMode: 'not_used',
              tools: [], counts: { modelCalls: 1, toolCalls: 0, queryEmbeddings: 0 }, proposals: [],
            });
            messagesByChild[cid] = [u, {
              id: '77777777-7777-4777-8777-999999999999',
              childId: cid, authorUserId: null, role: 'model', agentRunId: runId,
              text: replyText, inReplyTo: u.id, createdAt: new Date().toISOString(),
            }];
          }
          return json(200, { messages: messagesByChild[cid] ?? [], limit: 20, nextCursor: null });
        }
        if (sub === 'tasks') return json(200, { items: [], eligibleAssignees: [{ userId: USER_ID, name: '家長測試' }], nextAfterId: null });
        if (sub === 'photos') return json(200, { photos: [], canCreate: true });
        if (sub === 'inputs') return json(200, { inputs: [], sources: [], canCreate: true, hasMore: false, nextCursor: null });
        if (sub === 'growth') return json(200, { page: { authorityVersion: '1', items: [], historyHasMore: false, historyNextCursor: null, topics: [], notices: [], eligibleAssignees: [], canManage: true } });
        if (sub === 'concerns') return json(200, { page: { authorityVersion: '1', items: [], canManage: true, hasMore: false, nextCursor: null } });
        if (sub === 'documents') return json(200, { authorityVersion: '1', canManage: true, items: [], hasMore: false, nextCursor: null });
        if (sub === 'contact') return json(200, { canManage: true, workerEnabled: false, consent: { userId: USER_ID, version: 0, enabled: false, allowBackup: false, bindings: [] }, availableBindings: [], recipients: [], tasks: [], tasksHaveMore: false, grants: [], requests: [], historyLimited: false });
        if (sub === 'summary') {
          const period = { startDay: url.searchParams.get('startDay') || '2026-11-12', period: url.searchParams.get('period') || 'week', timeZone: url.searchParams.get('timeZone') || 'Asia/Hong_Kong' };
          return json(200, {
            childId: cid, childName: cid === CHILD_1_ID ? '小昕' : '阿樂', profile: profileFor(cid).profile, canManage: true, period,
            endDayExclusive: '2026-11-19', generatedAt: '2026-11-18T00:00:00.000Z', basisVersion: '1',
            counts: { note: 0, feeding: 0, sleep: 0, diaper: 0, temperature: 0, measurement: 0, appointment: 0 },
            metrics: [], records: [], missing: { unknownEventTime: 0, invalidQuantities: 0, emptyKinds: [] },
            appointments: [], conflicts: [],
            preparation: { version: 0, appointmentTaskId: null, questions: [], checklist: [], reviewed: false, reviewedBasis: null, period: null, updatedBy: null, updatedAt: null },
            reviewCurrent: false,
          });
        }
        if (sub === 'memory/facts' || sub === 'memory/topics') return json(200, { items: [], nextAfterId: null });
        if (sub === 'memory/summary') return json(200, { summary: null });
        if (sub === 'care') return json(200, { records: [], nextCursor: null });
        if (sub.endsWith('/seen')) return json(200, { seen: true });
      }

      if (p === '/api/shared-spaces' || p === '/api/shared-spaces/classes' || p === '/api/shared-spaces/teachers') {
        return json(200, { items: [], nextCursor: null });
      }
      if (p === '/api/family') return json(200, { members: [], invitations: [] });

      unroutedApi.push(`${m} ${p}`);
      return json(404, { error: { code: 'not_found' } });
    });
  }

  return {
    install,
    enableCompleteOnReload() { completeOnReload = true; },
    triggerAccessRevocation() { revokeAccessOnNextRead = true; },
    failNextAuthorizedHistoryRead() { failNextMessageRead = true; },
    seedTurn(text, reply, pendingStatus) {
      const stamp = () => new Date(Date.UTC(2026, 10, 1, 0, nextSeq)).toISOString();
      const nextId = () => `55555555-5555-4555-8555-${String(nextSeq++).padStart(12, '0')}`;
      const user = { id: nextId(), childId: CHILD_1_ID, role: 'user', authorUserId: USER_ID, text, inReplyTo: null, createdAt: stamp() };
      messagesByChild[CHILD_1_ID].push(user);
      const seedRun = (status, resultText) => {
        const runId = `66666666-6666-4666-8666-${String(nextSeq++).padStart(12, '0')}`;
        const stopReason = status === 'stopped' ? 'error' : null;
        replyStateByMsg.set(user.id, { messageId: user.id, runId, status, stopReason });
        runDetailsById.set(runId, {
          provenance: { packVersion: '0.1.60', recipeId: 'product-interactive', model: 'gemini-2.5-flash' },
          runId, status, stopReason, text: resultText, citations: [], retrievalMode: 'not_used', tools: [],
          counts: { modelCalls: 1, toolCalls: 0, queryEmbeddings: 0 }, proposals: [],
        });
        return runId;
      };
      if (pendingStatus) seedRun(pendingStatus, '');
      const appendReply = reply => {
        const agentRunId = reply.runStatus ? seedRun(reply.runStatus, reply.text) : undefined;
        messagesByChild[CHILD_1_ID].push({
          id: nextId(), childId: CHILD_1_ID, role: 'model', authorUserId: null, inReplyTo: user.id,
          text: reply.text, officialHelp: reply.officialHelp, agentRunId, createdAt: stamp(),
        });
      };
      if (reply) appendReply(reply);
      return appendReply;
    },
    getUnroutedApi: () => [...unroutedApi],
  };
}

async function openChatPage(browser, baseUrl, backend, { width = 390, height = 844 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  await backend.install(context, baseUrl);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });
  page.on('response', res => { if (res.status() >= 400) errors.push(`http-${res.status()}: ${res.url()}`); });
  await page.goto(`${baseUrl}/chat`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.getByTestId('frontend-preview-ready').waitFor({ timeout: 30000 });
  await page.getByTestId('chat-top-toolbar').waitFor({ timeout: 15000 });
  return { context, page, errors };
}

async function assertDockGeometryAndNoOcclusion(page, label, maxExpectedDockHeight) {
  const geom = await page.evaluate(() => {
    const pick = s => {
      const e = document.querySelector(s);
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height, offsetHeight: e.offsetHeight, scrollHeight: e.scrollHeight };
    };
    const dock = document.querySelector('[data-testid="chat-official-help-dock"]');
    const textbox = document.querySelector('textarea[aria-label="撰寫對話問題"]');
    const htmlZoom = parseFloat(getComputedStyle(document.documentElement).zoom || '1') || 1;
    const dockRect = pick('[data-testid="chat-official-help-dock"]');
    const composerRect = pick('[data-testid="chat-composer"]');
    const boxRect = pick('textarea[aria-label="撰寫對話問題"]');
    const readingPanelRect = pick('[data-testid="chat-reading-panel"]');
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      htmlZoom,
      rootOverflow: document.documentElement.scrollWidth - window.innerWidth,
      dockOffsetHeight: dockRect?.offsetHeight ?? null,
      toolbarRect: pick('[data-testid="chat-top-toolbar"]'),
      dockRect,
      composerRect,
      boxRect,
      readingPanelRect,
      insideSameDock: Boolean(dock && textbox && dock.contains(textbox)),
    };
  });
  const geomSummary = () => JSON.stringify(geom);
  assert.ok(Math.abs(geom.dockRect.left - geom.toolbarRect.left) <= 1 && Math.abs(geom.dockRect.right - geom.toolbarRect.right) <= 1, `${label}: official help must stay inside the chat column`);
  assert.ok(geom.rootOverflow <= 1, `${label}: horizontal overflow ${geom.rootOverflow}px (${geomSummary()})`);
  assert.ok(geom.dockOffsetHeight !== null && geom.dockOffsetHeight > 20, `${label}: dock must render with positive layout height (${geomSummary()})`);
  assert.ok(geom.dockOffsetHeight <= maxExpectedDockHeight + 2, `${label}: dock layout height ${geom.dockOffsetHeight} exceeds cap ${maxExpectedDockHeight} (zoom=${geom.htmlZoom}) (${geomSummary()})`);
  assert.ok(geom.boxRect && geom.boxRect.height >= 20, `${label}: composer textarea must be visible (${geomSummary()})`);
  assert.equal(geom.insideSameDock, false, `${label}: composer must stay outside help dock`);
  assert.ok(geom.composerRect && geom.dockRect.bottom <= geom.composerRect.top + 2, `${label}: dock bottom (${geom.dockRect.bottom}) overlaps composer container top (${geom.composerRect?.top})`);
  assert.ok(geom.dockRect.bottom <= geom.boxRect.top + 2, `${label}: dock bottom (${geom.dockRect.bottom}) overlaps composer textarea top (${geom.boxRect.top})`);
  assert.ok(geom.composerRect.bottom <= geom.innerHeight + 2, `${label}: entire composer bottom (${geom.composerRect.bottom}) pushed outside viewport height (${geom.innerHeight})`);
  assert.ok(geom.boxRect.bottom <= geom.innerHeight + 2, `${label}: composer textarea bottom (${geom.boxRect.bottom}) pushed outside viewport height (${geom.innerHeight})`);
}

let serverInfo;
let browser;

test.before(async () => {
  serverInfo = await startStaticDistServer();
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: 'msedge' }),
    args: ['--no-sandbox', '--disable-gpu', '--disable-gpu-sandbox', '--use-gl=swiftshader'],
  });
});

test.after(async () => {
  await browser?.close();
  await serverInfo?.close();
});

test('E2E 1: an empty conversation has no permanent help entry or cards', async () => {
  const backend = createSyntheticBackend({ hasChildren: false });
  const { context, page, errors } = await openChatPage(browser, serverInfo.baseUrl, backend, { width: 390, height: 844 });
  try {
    await page.getByText('先選擇孩子。', { exact: true }).waitFor();
    assert.equal(await page.getByTestId('chat-top-toolbar').getByRole('button', { name: /求助/ }).count(), 0);
    assert.equal(await page.getByTestId('chat-official-help-dock').count(), 0);
    assert.equal(await page.getByRole('textbox', { name: '撰寫對話問題', exact: true }).isDisabled(), true);
    assert.deepEqual(errors, [], `unexpected browser errors: ${JSON.stringify(errors)}`);
  } finally {
    await context.close();
  }
});

test('E2E 2: Real DOM layout across desktop, mobile, keyboard-height simulation, enlarged CSS text, and deterministic rules', async () => {
  const configs = [
    { width: 1440, height: 900, scale: 1, maxDock: 220, label: 'desktop-1440' },
    { width: 390, height: 844, scale: 1, maxDock: 220, label: 'mobile-390x844' },
    { width: 360, height: 640, scale: 1, maxDock: 179, label: 'mobile-360x640' },
    { width: 320, height: 720, scale: 1, maxDock: 202, label: 'mobile-320x720' },
    { width: 390, height: 420, scale: 1, maxDock: 132, label: 'keyboard-sim-390x420' },
    { width: 360, height: 380, scale: 1, maxDock: 132, label: 'keyboard-sim-360x380' },
    { width: 360, height: 640, scale: 2, maxDock: 179, label: 'enlarged-text-200pct-360x640' },
  ];

  for (const cfg of configs) {
    const backend = createSyntheticBackend({ hasChildren: true });
    const { context, page, errors } = await openChatPage(browser, serverInfo.baseUrl, backend, { width: cfg.width, height: cfg.height });
    try {
      const textbox = page.getByRole('textbox', { name: '撰寫對話問題', exact: true });
      await textbox.waitFor();
      try {
        await page.waitForFunction(() => {
          const el = document.querySelector('textarea[aria-label="撰寫對話問題"]');
          return Boolean(el && !el.disabled);
        }, undefined, { timeout: 5000 });
      } catch {
        const bodyText = await page.locator('body').innerText();
        throw new Error(`${cfg.label} composer stayed disabled. errors=${JSON.stringify(errors)} unrouted=${JSON.stringify(backend.getUnroutedApi())} body=${bodyText.replace(/\s+/g, ' ').slice(0, 400)}`);
      }
      await textbox.fill('個故仔好好笑，笑到抽筋');
      assert.equal(await page.getByTestId('chat-official-help-dock').count(), 0, `${cfg.label}: pure joke must not open dock`);

      await textbox.fill('Can I book a non-emergency medicine review?');
      await page.getByTestId('chat-official-help-consult-notice').waitFor();
      assert.equal(await page.getByTestId('chat-official-help-urgent-notice').count(), 0, `${cfg.label}: non-emergency consult only`);

      await textbox.fill('BB笑到抽筋，之後失去意識');
      const alertNode = page.getByTestId('chat-official-help-urgent-notice');
      await alertNode.waitFor();
      assert.deepEqual(await page.getByTestId('official-help-card').evaluateAll(cards => cards.map(card => card.getAttribute('aria-label'))), ['緊急求助']);
      assert.equal(await alertNode.getAttribute('role'), 'alert', `${cfg.label}: emergency notice must expose ARIA alert role`);

      if (cfg.scale > 1) {
        await page.evaluate(scale => {
          for (const el of document.querySelectorAll('div, span, p, button')) {
            if (![...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())) continue;
            const cs = getComputedStyle(el);
            const fs = parseFloat(cs.fontSize);
            if (fs > 0) el.style.fontSize = `${fs * scale}px`;
            if (cs.lineHeight !== 'normal') {
              const lh = parseFloat(cs.lineHeight);
              if (lh > 0) el.style.lineHeight = `${lh * scale}px`;
            }
          }
        }, cfg.scale);
      }

      await assertDockGeometryAndNoOcclusion(page, cfg.label, cfg.maxDock);
      // Verify composer textarea still accepts typing directly after enlarged/keyboard layout settles
      await textbox.fill('BB笑到抽筋，之後失去意識！');
      assert.equal(await textbox.inputValue(), 'BB笑到抽筋，之後失去意識！');
      assert.deepEqual(errors, [], `${cfg.label} errors: ${JSON.stringify(errors)}`);
    } finally {
      await context.close();
    }
  }
});

test('shared header keeps its borderless bell and sidebar usable on home and chat', async () => {
  for (const width of [1440, 390]) {
    const { context, page } = await openChatPage(browser, serverInfo.baseUrl, createSyntheticBackend(), { width, height: 844 });
    try {
      for (const pathname of ['/chat', '/']) {
        if (pathname === '/') await page.goto(serverInfo.baseUrl);
        const header = page.getByTestId('header-actions');
        const bell = header.getByRole('button', { name: BELL_LABEL });
        const sidebar = header.getByRole('button', { name: '開啟資訊側欄' });
        for (const control of [bell, sidebar]) {
          await control.waitFor();
          const { width: w, height: h } = await control.boundingBox();
          assert.ok(w >= 44 && h >= 44, `${pathname} at ${width}px: target ${w}×${h}`);
          assert.equal(await control.evaluate(el => [el, ...el.querySelectorAll('div')].every(node => getComputedStyle(node).borderTopWidth === '0px')), true);
        }
        await bell.press('Enter');
        const dialog = page.getByRole('dialog');
        await dialog.getByText('最近消息', { exact: true }).waitFor();
        await dialog.getByRole('button', { name: '關閉', exact: true }).click();
        await sidebar.click();
        await header.getByRole('button', { name: '收起資訊側欄', includeHidden: true }).waitFor({ state: 'attached' });
      }
    } finally {
      await context.close();
    }
  }
});

test('E2E 3: Real send/SSE 503 help retention across stopped turn, child switch isolation, and reload completion clearing', async () => {
  const backend = createSyntheticBackend({ hasChildren: true, failReplyWithHelpCard: true });
  const { context, page, errors } = await openChatPage(browser, serverInfo.baseUrl, backend, { width: 390, height: 844 });
  try {
    const textbox = page.getByRole('textbox', { name: '撰寫對話問題', exact: true });
    await textbox.fill('幫我睇下呢張相應該點處理？');
    assert.equal(await page.getByTestId('chat-official-help-dock').count(), 0, 'generic draft has no help dock initially');

    await page.getByRole('button', { name: '送出', exact: true }).click();
    // Wait until SSE 503 recovery settles AND server SSE emergency card stays retained
    try {
      await page.getByText('已核對原運行，聊天回覆尚未讀到。請重新讀取原結果，沒有重新執行。', { exact: false }).waitFor({ timeout: 5000 });
    } catch {
      const txt = await page.locator('body').innerText();
      throw new Error('E2E3 send/503 body=' + txt.replace(/\s+/g, ' ').slice(0, 600));
    }
    await page.getByTestId('chat-official-help-urgent-notice').waitFor();
    await assertDockGeometryAndNoOcclusion(page, 'post-failure-retained-dock', 220);

    // Switch child from 小昕 -> 阿樂; dock must clear cleanly
    await page.getByRole('button', { name: '選擇孩子，目前小昕', exact: true }).click();
    await page.getByRole('radio', { name: /阿樂/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="chat-official-help-dock"]').length === 0, undefined, { timeout: 10000 });

    // Switch back to 小昕 with completed reply on backend -> retained emergency dock clears
    backend.enableCompleteOnReload();
    await page.getByRole('button', { name: '選擇孩子，目前阿樂', exact: true }).click();
    await page.getByRole('radio', { name: /小昕/ }).click();
    await page.getByText('已完成回覆。', { exact: true }).waitFor({ timeout: 15000 });
    assert.equal(await page.getByTestId('chat-official-help-dock').count(), 0, 'completed reply clears retained emergency SSE dock');
    assert.deepEqual(errors, [], `unexpected browser errors: ${JSON.stringify(errors)}`);
  } finally {
    await context.close();
  }
});

test('E2E 4: Focus stays put on progress updates, retained official sources survive 503 and clear on completion/revocation, and buffered answers appear immediately with safe details', async () => {
  // Part A: SSE progress updates never steal focus, 503 failure retains qualified ProgressSourceCards without draft text, and completion clears them
  const failBackend = createSyntheticBackend({ hasChildren: true, failReplyWithSourcesOnly: true, replyDelayMs: 220 });
  const { context: c1, page: p1, errors: e1 } = await openChatPage(browser, serverInfo.baseUrl, failBackend, { width: 390, height: 844 });
  try {
    const textbox = p1.getByRole('textbox', { name: '撰寫對話問題', exact: true });
    await textbox.fill('BB幾時可以開始食固體食物？');
    await p1.getByRole('button', { name: '送出', exact: true }).click();
    await p1.getByRole('button', { name: BELL_LABEL, exact: true }).focus();

    await p1.getByTestId('chat-progress-sources').waitFor({ timeout: 10000 });
    await p1.getByTestId('chat-progress-sources-retained-notice').waitFor({ timeout: 10000 });
    await p1.getByText('重試原訊息回覆', { exact: true }).waitFor({ timeout: 5000 });

    const focusedDuringAndAfter = await p1.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    assert.equal(focusedDuringAndAfter, BELL_LABEL, 'SSE progress updates and retained source cards must never steal keyboard focus');

    const retainedText = await p1.getByTestId('chat-progress-sources').innerText();
    assert.match(retainedText, /嬰幼兒飲食－引進固體食物過渡期/);
    assert.match(retainedText, /未核草稿不會作正式建議顯示/);
    assert.equal(await p1.getByRole('button', { name: '開始新訊息', exact: true }).count(), 1);

    failBackend.failNextAuthorizedHistoryRead();
    await p1.getByRole('button', { name: '重試原訊息回覆', exact: true }).click();
    await p1.getByRole('button', { name: '重試讀取聊天', exact: true }).waitFor();
    await p1.getByTestId('chat-progress-sources-retained-notice').waitFor();

    // Reload with completed reply clears retained ProgressSourceCards cleanly
    failBackend.enableCompleteOnReload();
    await p1.getByRole('button', { name: '選擇孩子，目前小昕', exact: true }).click();
    await p1.getByRole('radio', { name: /阿樂/ }).click();
    await p1.waitForFunction(() => document.querySelectorAll('[data-testid="chat-progress-sources"]').length === 0, undefined, { timeout: 10000 });
    await p1.getByRole('button', { name: '選擇孩子，目前阿樂', exact: true }).click();
    await p1.getByRole('radio', { name: /小昕/ }).click();
    await p1.getByText('已完成回覆。', { exact: true }).waitFor({ timeout: 15000 });
    assert.equal(await p1.getByTestId('chat-progress-sources').count(), 0);
    assert.ok(e1.some(item => item.startsWith('http-503:') && item.includes('/messages')));
    assert.deepEqual(e1.filter(item => !item.includes('503')), [], `E2E 4 Part A errors: ${JSON.stringify(e1)}`);
  } finally {
    await c1.close();
  }

  // Part B: 403 revocation clears retained sources immediately in UI (expected 403 logged as response status)
  const revokeBackend = createSyntheticBackend({ hasChildren: true, failReplyWithSourcesOnly: true });
  const { context: c2, page: p2, errors: e2 } = await openChatPage(browser, serverInfo.baseUrl, revokeBackend, { width: 390, height: 844 });
  try {
    await p2.getByRole('textbox', { name: '撰寫對話問題', exact: true }).fill('BB飲食問題');
    await p2.getByRole('button', { name: '送出', exact: true }).click();
    await p2.getByTestId('chat-progress-sources-retained-notice').waitFor({ timeout: 10000 });
    revokeBackend.triggerAccessRevocation();
    await p2.getByRole('button', { name: '重試原訊息回覆', exact: true }).click();
    await p2.waitForFunction(() => document.querySelectorAll('[data-testid="chat-progress-sources"]').length === 0, undefined, { timeout: 10000 });
    assert.equal(await p2.getByRole('button', { name: '重試原訊息回覆', exact: true }).count(), 0);
    assert.ok(e2.some(item => item.includes('http-403:')), `expected HTTP 403 revocation response, got ${JSON.stringify(e2)}`);
    assert.deepEqual(e2.filter(item => !item.includes('403')), [], `unexpected errors in E2E 4 Part B: ${JSON.stringify(e2)}`);
  } finally {
    await c2.close();
  }

  // Part C: Buffered approved reply renders complete text immediately with zero typing animation, and details dialog never leaks internal thoughts/raw JSON args
  const okBackend = createSyntheticBackend({ hasChildren: true, completeWithCitation: true });
  const { context: c3, page: p3, errors: e3 } = await openChatPage(browser, serverInfo.baseUrl, okBackend, { width: 1440, height: 900 });
  try {
    const fullAnswer = '根據衞生署指引，約六個月大可開始引入固體食物。【1】';
    await p3.getByRole('textbox', { name: '撰寫對話問題', exact: true }).fill('半歲BB幾時食固體？');
    await p3.getByRole('button', { name: '送出', exact: true }).click();
    await p3.getByText(fullAnswer, { exact: true }).waitFor({ timeout: 10000 });
    assert.equal(await p3.getByTestId('chat-progress-sources').count(), 0, 'progress source preview clears after approved delivery');

    await p3.getByRole('button', { name: '查看這則回覆的來源與候選', exact: true }).last().click();
    const dialog = p3.getByRole('dialog');
    await dialog.waitFor({ timeout: 10000 });
    await p3.getByTestId('agent-run-view').waitFor({ timeout: 10000 });
    const dialogText = await dialog.innerText();
    assert.doesNotMatch(dialogText, /functionCall|thought|candidatesTokenCount|fhs-solid-food/i, 'details dialog must not expose internal thinking or raw tool payloads');
    assert.deepEqual(e3, [], `E2E 4 Part C errors: ${JSON.stringify(e3)}`);
  } finally {
    await c3.close();
  }

  // Part D: Start New leaves the old message in history, not in the next draft's help or sources.
  const foundBackend = createSyntheticBackend({ failReplyWithSourcesOnly: true, failBeforeRead: true });
  const { context: c4, page: p4, errors: e4 } = await openChatPage(browser, serverInfo.baseUrl, foundBackend, { width: 390, height: 844 });
  try {
    const textbox = p4.getByRole('textbox', { name: '撰寫對話問題', exact: true });
    const urgent = p4.getByTestId('chat-official-help-urgent-notice');
    await textbox.fill('BB突然呼吸困難');
    await p4.getByRole('button', { name: '送出', exact: true }).click();
    const retained = p4.getByTestId('chat-progress-sources-retained-notice');
    await retained.waitFor();
    await urgent.waitFor();
    assert.doesNotMatch(await retained.innerText(), /已讀取/);
    assert.match(await p4.getByTestId('chat-progress-source-card').innerText(), /已找到官方來源/);
    await p4.getByRole('button', { name: '開始新訊息', exact: true }).click();
    await p4.getByTestId('chat-official-help-dock').waitFor({ state: 'hidden' });
    await p4.getByTestId('chat-progress-sources').waitFor({ state: 'hidden' });
    assert.equal(await textbox.inputValue(), '');
    await p4.getByText('BB突然呼吸困難', { exact: true }).waitFor();
    await textbox.fill('Can I book a non-emergency medicine review?');
    await p4.getByTestId('chat-official-help-consult-notice').waitFor();
    assert.equal(await urgent.count(), 0, 'a new consultation must not revive the old emergency');
    await textbox.fill('BB而家抖唔到氣');
    await urgent.waitFor();
    assert.deepEqual(e4, [], `E2E 4 Part D errors: ${JSON.stringify(e4)}`);
  } finally {
    await c4.close();
  }
});

test('E2E 5: a failed retry of an older turn keeps its own feedback instead of the newer turn', async () => {
  const backend = createSyntheticBackend({ failReplyWithSourcesOnly: true });
  backend.seedTurn('較早的合成問題');
  backend.seedTurn('稍後的合成問題', { text: '已完成合成回覆。', officialHelp: ['emergency-hk-v1'] });
  const { context, page, errors } = await openChatPage(browser, serverInfo.baseUrl, backend);
  try {
    const dock = page.getByTestId('chat-official-help-dock');
    await page.getByText('已完成合成回覆。', { exact: true }).waitFor();
    assert.equal(await dock.count(), 0, 'saved help on a completed turn belongs in history only');
    await page.getByRole('button', { name: '要求這則已保存訊息的回覆', exact: true }).click();
    await page.getByTestId('chat-progress-sources-retained-notice').waitFor();
    assert.match(await page.getByTestId('chat-progress-sources').innerText(), /嬰幼兒飲食－引進固體食物過渡期/);
    assert.equal(await dock.count(), 0, 'a retry cannot borrow the newer response’s emergency help');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('E2E 6: reload restores the active unfinished turn’s saved official help without replaying other turns', async () => {
  const backend = createSyntheticBackend();
  backend.seedTurn('已經處理的合成問題', { text: '已完成合成回覆。', officialHelp: ['medical-consult-hk-v1'] });
  const appendResult = backend.seedTurn('請查看這個合成狀況', { text: '這次回覆未完成：合成中止。', officialHelp: ['emergency-hk-v1'] });
  const { context, page, errors } = await openChatPage(browser, serverInfo.baseUrl, backend);
  try {
    for (let pass = 0; pass < 2; pass++) {
      if (pass) await page.reload({ waitUntil: 'domcontentloaded' });
      const dock = page.getByTestId('chat-official-help-dock');
      await dock.getByTestId('chat-official-help-urgent-notice').waitFor();
      assert.deepEqual(await dock.getByTestId('official-help-card').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))), ['緊急求助']);
      assert.equal(await page.getByTestId('chat-progress-sources').count(), 0, 'saved help does not fabricate streamed sources');
    }
    appendResult({ text: '原訊息已獲完整回覆。', officialHelp: ['medical-consult-hk-v1'] });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('原訊息已獲完整回覆。', { exact: true }).waitFor();
    assert.equal(await page.getByTestId('chat-official-help-dock').count(), 0, 'a completed result supersedes a stopped row for the same user turn');
    backend.seedTurn('新的合成問題', { text: '新回覆已完成。', officialHelp: ['emergency-hk-v1'] });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('新回覆已完成。', { exact: true }).waitFor();
    assert.equal(await page.getByTestId('chat-official-help-dock').count(), 0, 'completed or superseded history must not re-open the dock');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('E2E 7: an unrelated running turn does not lock dismissal of an older retry’s retained feedback', async () => {
  const backend = createSyntheticBackend({ failReplyWithSourcesOnly: true });
  const olderText = '較早的合成提問';
  backend.seedTurn(olderText);
  backend.seedTurn('仍在處理的另一則提問', null, 'running');
  const { context, page, errors } = await openChatPage(browser, serverInfo.baseUrl, backend);
  try {
    const ongoing = page.getByText('原回覆仍在處理，毋須重新發送。', { exact: true });
    const olderRetry = page.getByTestId('chat-message').filter({ hasText: olderText })
      .getByRole('button', { name: '要求這則已保存訊息的回覆', exact: true });
    const retained = page.getByTestId('chat-progress-sources-retained-notice');
    await ongoing.waitFor();
    await olderRetry.click();
    await retained.waitFor();
    // A second read-only check of the saved older run reloads history and rediscovers the newer pending one.
    await olderRetry.click();
    await ongoing.waitFor();
    await page.getByRole('button', { name: '收起這次查核提示', exact: true }).click();
    await retained.waitFor({ state: 'hidden' });
    assert.equal(await ongoing.isVisible(), true, 'dismissing the older feedback does not stop the newer run');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('E2E 8: a cold chat restores saved official help from the matching run status without failure wording', async () => {
  for (const status of ['stopped', 'unknown']) {
    const backend = createSyntheticBackend();
    backend.seedTurn('請看看合成情況。', {
      text: '已保存合成觀察。', officialHelp: ['emergency-hk-v1'], runStatus: status,
    });
    const { context, page, errors } = await openChatPage(browser, serverInfo.baseUrl, backend);
    try {
      const dock = page.getByTestId('chat-official-help-dock');
      await dock.getByTestId('chat-official-help-urgent-notice').waitFor();
      assert.equal(await dock.getByTestId('official-help-card').count(), 1);
      assert.equal(await page.getByTestId('chat-progress-sources').count(), 0);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});
