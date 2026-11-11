import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminOwner } from '../src/production/AdminOwner.ts';
import { emptyDemo, demoDeliveryLabel, demoReasonLabel, adminDemoReceiptSchema } from '../src/production/admin-proactive-demo.ts';
import { harness } from './scope-transition-harness.mjs';
import { pushDeliverySchema } from '../../src/shared/web-push.ts';

const deliveryId = '11111111-1111-4111-8111-111111111111';
const receipt = (opId, status = 'accepted', reason = null) => ({ opId, messageId: 'demo-message', text: '合成示範訊息',
  deliveries: [{ id: deliveryId, status, reason }] });
test('demo receipts accept only known chat deferral and unavailability reasons', () => {
  for (const reason of ['foreground_chat', 'chat_consent_disabled', 'quiet_hours', 'message_unavailable', 'proactive_disabled', 'task_unavailable']) {
    assert.equal(adminDemoReceiptSchema.safeParse(receipt(deliveryId, 'stopped', reason)).success, true);
    assert.notEqual(demoReasonLabel(reason), reason);
  }
  assert.equal(adminDemoReceiptSchema.safeParse(receipt(deliveryId, 'stopped', 'arbitrary_reason')).success, false);
});
const setup = async (handler) => {
  const calls = [];
  const owner = new AdminOwner('https://synthetic.invalid', async (input, options) => {
    const path = new URL(input).pathname; calls.push({ path, options });
    assert.equal(options.credentials, 'include'); assert.equal(options.cache, 'no-store');
    assert.equal(options.headers['x-expected-user-id'], owner.getSnapshot().userId);
    if (path.endsWith('/session')) return Response.json({ administrator: true });
    return handler(path, options);
  });
  owner.setUser('admin-a'); await owner.checkAccess();
  return { owner, calls };
};

test('demo requires enabled config and preserves original operation while delivery is queued or unknown', async () => {
  let enabled = false, status = 'queued', opId;
  const { owner, calls } = await setup((path, options) => {
    if (options.method === 'POST') { const body = JSON.parse(options.body); assert.deepEqual(Object.keys(body), ['opId']); opId = body.opId; return Response.json(receipt(opId, status)); }
    if (path.endsWith('/proactive-demo')) return Response.json({ enabled });
    assert.ok(path.endsWith('/' + opId)); return Response.json(receipt(opId, status));
  });
  await owner.sendDemo(); assert.equal(calls.length, 1);
  await owner.loadDemo(); await owner.sendDemo(); assert.equal(calls.filter(c => c.options.method === 'POST').length, 0);
  enabled = true; await owner.loadDemo(); await Promise.all([owner.sendDemo(), owner.sendDemo()]);
  assert.equal(calls.filter(c => c.options.method === 'POST').length, 1);
  assert.equal(owner.getSnapshot().demo.pending, opId);
  status = 'unknown'; await owner.recoverDemo(); assert.equal(owner.getSnapshot().demo.pending, opId);
  assert.equal(owner.getSnapshot().demo.receipt.deliveries[0].status, 'unknown');
  status = 'accepted'; await owner.retryDemo(); assert.equal(owner.getSnapshot().demo.pending, null);
  assert.equal(calls.filter(c => c.options.method === 'POST')[1].options.body, JSON.stringify({ opId }));
  owner.dispose();
});

test('lost replies, missing receipts and malformed bindings retain the original operation', async () => {
  let mode = 'network', opId;
  const { owner, calls } = await setup((path, options) => {
    if (options.method === 'GET' && path.endsWith('/proactive-demo')) return Response.json({ enabled: true });
    if (options.method === 'POST') opId = JSON.parse(options.body).opId;
    if (mode === 'network') throw new Error('Synthetic connection loss');
    if (mode === 'missing') return Response.json({ error: { code: 'not_found' } }, { status: 404 });
    if (mode === 'mismatch') return Response.json(receipt('22222222-2222-4222-8222-222222222222'));
    return Response.json({ ...receipt(opId), deliveries: [] });
  });
  await owner.loadDemo(); await owner.sendDemo();
  const original = owner.getSnapshot().demo.pending; assert.equal(original, opId);
  mode = 'missing'; await owner.recoverDemo(); await owner.sendDemo();
  assert.equal(owner.getSnapshot().demo.pending, original);
  assert.equal(calls.filter(c => c.options.method === 'POST').length, 1);
  mode = 'mismatch'; await owner.retryDemo(); assert.equal(owner.getSnapshot().demo.pending, original);
  mode = 'zero'; await owner.recoverDemo(); assert.equal(owner.getSnapshot().demo.pending, null);
  assert.deepEqual(owner.getSnapshot().demo.receipt.deliveries, []);
  owner.dispose();
});

test('identity changes and denied admin access discard late receipts and hide prior content', async () => {
  let finish, deny = false;
  const { owner } = await setup((path, options) => {
    if (deny) return Response.json({ error: { code: 'forbidden' } }, { status: 403 });
    if (options.method === 'GET') return Response.json({ enabled: true });
    return new Promise(resolve => { finish = () => resolve(Response.json(receipt(JSON.parse(options.body).opId))); });
  });
  await owner.loadDemo(); const send = owner.sendDemo(); owner.setUser('admin-b'); finish(); await send;
  assert.deepEqual(owner.getSnapshot().demo, emptyDemo());
  await owner.checkAccess(); await owner.loadDemo();
  const retry = owner.sendDemo(), original = owner.getSnapshot().demo.pending;
  deny = true; await owner.setKnowledgeOpen(true);
  finish(); await retry;
  assert.equal(owner.getSnapshot().access, 'error');
  assert.equal(owner.getSnapshot().demo.receipt, null);
  assert.equal(owner.getSnapshot().demo.enabled, false);
  assert.equal(owner.getSnapshot().demo.pending, original, 'Revocation retains only the unresolved operation ID for the same identity');
  owner.dispose();
});

test('actual demo panel wires original-ID recovery and shows honest delivery and zero-binding states', () => {
  const h = harness({ '../ui': { AppButton: 'Button', SectionHeader: 'Header' } });
  const { AdminProactiveDemo } = h.load('src/components/admin/AdminProactiveDemo.tsx');
  const actions = [];
  const admin = { loadDemo: () => actions.push('config'), sendDemo: () => actions.push('send'), recoverDemo: () => actions.push('recover'), retryDemo: () => actions.push('retry') };
  let state = { ...emptyDemo(), status: 'ready', enabled: true };
  const render = () => h.render(h.jsx(AdminProactiveDemo, { admin, state, online: true, writeLocked: false }));
  const button = label => h.hosts().find(node => node.type === 'Button' && node.props.label === label);
  const texts = () => JSON.stringify(h.hosts().filter(node => node.type === 'Text').map(node => node.props.children));
  render(); button('一鍵示範主動訊息').props.onPress(); assert.deepEqual(actions, ['send']);
  const opId = '33333333-3333-4333-8333-333333333333';
  state = { ...state, pending: opId, receipt: receipt(opId, 'stopped', 'local_preview_not_sent') }; render();
  assert.equal(button('一鍵示範主動訊息').props.disabled, true);
  button('查回原示範收據及狀態').props.onPress(); button('以原 ID 重送示範操作').props.onPress();
  assert.deepEqual(actions, ['send', 'recover', 'retry']);
  assert.match(texts(), /僅本機預覽，未發送/); assert.match(texts(), /不代表真實裝置已收到/);
  assert.equal(demoDeliveryLabel('queued'), '已排隊，尚未確認交送'); assert.equal(demoDeliveryLabel('unknown'), '結果未知');
  assert.equal(demoReasonLabel('local_preview_not_sent'), '僅本機預覽，未發送');
  state = { ...state, pending: null, receipt: { ...state.receipt, deliveries: [] } }; render();
  assert.match(texts(), /沒有通知交送項目/); assert.match(texts(), /沒有已綁定的通知裝置/);
  h.unmount();
});

test('pending demo identity survives reload only for its admin UID and API deployment', async () => {
  const saved = new Map(), posts = [];
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  const fetcher = async (input, options) => {
    const path = new URL(input).pathname;
    if (path.endsWith('/session')) return Response.json({ administrator: true });
    if (options.method === 'POST') { posts.push(JSON.parse(options.body)); throw new Error('Synthetic lost response'); }
    if (path.endsWith('/proactive-demo')) return Response.json({ enabled: true });
    return Response.json(receipt(path.split('/').at(-1)));
  };
  const first = new AdminOwner('https://synthetic.invalid', fetcher, storage);
  first.setUser('admin-a'); await first.checkAccess(); await first.loadDemo(); await first.sendDemo();
  const original = first.getSnapshot().demo.pending; assert.ok(original); assert.equal(first.getSnapshot().demo.recoveryStored, true);
  assert.deepEqual([...saved.values()], [original], 'Only the operation ID is persisted, with no receipt text or family data');
  first.dispose();
  const reloaded = new AdminOwner('https://synthetic.invalid', fetcher, storage);
  reloaded.setUser('admin-b'); assert.equal(reloaded.getSnapshot().demo.pending, null);
  reloaded.setUser('admin-a'); assert.equal(reloaded.getSnapshot().demo.pending, original);
  await reloaded.checkAccess(); await reloaded.loadDemo(); await reloaded.sendDemo(); assert.equal(posts.length, 1);
  const otherDeployment = new AdminOwner('https://synthetic.invalid/another', fetcher, storage);
  otherDeployment.setUser('admin-a'); assert.equal(otherDeployment.getSnapshot().demo.pending, null);
  await reloaded.recoverDemo(); assert.equal(reloaded.getSnapshot().demo.pending, null); assert.equal(saved.size, 0);
  reloaded.dispose(); otherDeployment.dispose();
});

test('native and Web shared delivery statuses and reasons all have explicit Chinese labels', () => {
  for (const status of pushDeliverySchema.shape.status.options) assert.notEqual(demoDeliveryLabel(status), '未識別狀態，待核對', status);
  for (const reason of pushDeliverySchema.shape.reason.unwrap().options) assert.notEqual(demoReasonLabel(reason), reason, reason);
});
