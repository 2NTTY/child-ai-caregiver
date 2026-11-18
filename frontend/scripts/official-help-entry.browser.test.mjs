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

const HELP_TOGGLE_LABEL = '查看香港緊急求助、急症室、母嬰健康院及安全用藥官方入口（毋須等待 AI 回覆）';

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

function createSyntheticBackend({ hasChildren = true, failReplyWithHelpCard = false } = {}) {
  const child1 = { id: CHILD_1_ID, workspaceId: WORKSPACE_ID, displayName: '小昕', createdAt: '2026-11-01T00:00:00.000Z', accessRole: 'owner' };
  const child2 = { id: CHILD_2_ID, workspaceId: WORKSPACE_ID, displayName: '阿樂', createdAt: '2026-11-01T00:00:00.000Z', accessRole: 'owner' };
  const messagesByChild = { [CHILD_1_ID]: [], [CHILD_2_ID]: [] };
  const replyStateByMsg = new Map();
  const runStatusById = new Map();
  let nextSeq = 1;
  let unroutedApi = [];
  let completeOnReload = false;

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
        if (m === 'GET') {
          return json(200, { reply: replyStateByMsg.get(msgId) ?? null });
        }
        if (m === 'POST') {
          const runId = `66666666-6666-4666-8666-${String(nextSeq++).padStart(12, '0')}`;
          if (failReplyWithHelpCard) {
            replyStateByMsg.set(msgId, { messageId: msgId, runId, status: 'stopped', stopReason: 'error' });
            runStatusById.set(runId, 'stopped');
            const sse = [
              `data: ${JSON.stringify({ type: 'progress', progress: { runId, messageId: msgId, phase: 'help', card: 'emergency-hk-v1' } })}\n\n`,
              `data: ${JSON.stringify({ type: 'result', status: 503, body: { error: { code: 'ai_unavailable' } } })}\n\n`,
            ].join('');
            return route.fulfill({ status: 200, contentType: 'text/event-stream; charset=utf-8', body: sse });
          }
          replyStateByMsg.set(msgId, { messageId: msgId, runId, status: 'completed', stopReason: null });
          runStatusById.set(runId, 'completed');
          const modelMsg = {
            id: `77777777-7777-4777-8777-${String(nextSeq++).padStart(12, '0')}`,
            childId: cid, authorUserId: null, role: 'model', agentRunId: runId,
            text: '已完成回覆。', inReplyTo: msgId, createdAt: new Date().toISOString(),
          };
          messagesByChild[cid] = [...(messagesByChild[cid] ?? []), modelMsg];
          const sse = `data: ${JSON.stringify({ type: 'result', status: 200, body: { message: modelMsg } })}\n\n`;
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
        if (sub === 'agent/work') return json(200, { items: [], nextCursor: null, complete: true });
        if (sub === 'library') return json(200, { items: [], nextCursor: null, complete: true });
        if (sub.startsWith('agent/runs/')) {
          const rid = sub.slice('agent/runs/'.length);
          return json(200, { result: { runId: rid, status: runStatusById.get(rid) ?? 'stopped' } });
        }
        if (sub === 'messages') {
          if (completeOnReload && cid === CHILD_1_ID && messagesByChild[cid]?.length === 1) {
            const u = messagesByChild[cid][0];
            const prevState = replyStateByMsg.get(u.id);
            const runId = prevState?.runId ?? '66666666-6666-4666-8666-999999999999';
            replyStateByMsg.set(u.id, { messageId: u.id, runId, status: 'completed', stopReason: null });
            runStatusById.set(runId, 'completed');
            messagesByChild[cid] = [u, {
              id: '77777777-7777-4777-8777-999999999999',
              childId: cid, authorUserId: null, role: 'model', agentRunId: runId,
              text: '已完成回覆。', inReplyTo: u.id, createdAt: new Date().toISOString(),
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
      dockRect,
      composerRect,
      boxRect,
      readingPanelRect,
      insideSameDock: Boolean(dock && textbox && dock.contains(textbox)),
    };
  });
  const geomSummary = () => JSON.stringify(geom);
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

test('E2E 1: Permanent toolbar toggle works with keyboard + ARIA roles even without a selected child', async () => {
  const backend = createSyntheticBackend({ hasChildren: false });
  const { context, page, errors } = await openChatPage(browser, serverInfo.baseUrl, backend, { width: 390, height: 844 });
  try {
    await page.getByText('先選擇孩子。', { exact: true }).waitFor();
    const toggle = page.getByRole('button', { name: HELP_TOGGLE_LABEL, exact: true });
    await toggle.waitFor();
    assert.equal(await page.getByTestId('chat-official-help-dock').count(), 0, 'help dock should start collapsed');

    // Keyboard activation
    await toggle.focus();
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    assert.equal(focused, HELP_TOGGLE_LABEL, 'toolbar toggle button must accept keyboard focus');
    await page.keyboard.press('Enter');

    await page.getByTestId('chat-official-help-dock').waitFor();
    await page.getByTestId('chat-official-help-panel').waitFor();
    assert.equal(await page.getByTestId('official-help-card').count(), 2, 'manual toggle reveals both emergency & medical cards');
    const cardLabels = await page.getByTestId('official-help-card').evaluateAll(els => els.map(el => el.getAttribute('aria-label')));
    assert.deepEqual(cardLabels, ['緊急求助', '醫療與用藥諮詢']);
    assert.equal(await page.getByRole('textbox', { name: '撰寫對話問題', exact: true }).isDisabled(), true, 'composer disabled without child but still mounted cleanly');

    await toggle.press('Enter');
    assert.equal(await page.getByTestId('chat-official-help-dock').count(), 0, 'second keyboard press collapses help dock');
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
