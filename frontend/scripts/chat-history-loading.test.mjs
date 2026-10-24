import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

test('history reveals locally, requests one remote page, and retries only explicitly after failure', async () => {
  let calls = 0, resolveRead, captures = 0;
  const frames = new Map(); let nextFrame = 0;
  globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  const scroll = { scrollToEnd() {}, scrollTo() {} };
  const h = harness({
    '../AppScrollView': { AppScrollView: props => { props.ref(scroll); return h.jsx('ScrollView', props); } },
    '../AppIcon': { AppIcon: 'Icon' }, './ChatMessage': { ChatProgressIndicator: 'Progress' },
    './chat-presentation': { chatColors: {}, chatFont: 'test', chatLayout: {}, chatType: { meta: {} } },
    '../useInteractionDensity': { useInteractionDensity: () => false },
    './useChatInitialPosition': { useChatInitialPosition: () => () => {} },
    './useChatScrollIntent': { useChatScrollIntent() {} },
    './useChatReadingAnchor': { useChatReadingAnchor: () => ({ capture() { captures++; }, cancel() {}, maintainVisibleContentPosition: { minIndexForVisible: 1 } }) },
    '../../motion': { MotionEntrance: ({ children }) => children },
  });
  h.react.useId = () => 'timeline';
  h.react.useImperativeHandle = (ref, create, deps) => h.react.useLayoutEffect(() => { ref.current = create(); }, deps);
  const { ChatTimeline } = h.load('src/components/chat/ChatTimeline.tsx');
  let items = Array.from({ length: 8 }, (_, index) => ({ id: String(index + 3) }));
  let history = { cursor: 'first', enabled: true, loading: false, load: () => { calls++; return new Promise(resolve => { resolveRead = resolve; }); } };
  const render = () => h.render(h.jsx(ChatTimeline, { items, recentLimit: 3, renderItem: item => h.jsx('Message', { children: item.id }), history }));
  const ids = () => h.hosts().filter(node => node.type === 'Message').map(node => node.props.children);
  const dragTop = () => { h.node('chat-timeline-scroll').props.onScrollBeginDrag(); render(); };
  render();
  assert.deepEqual(ids(), ['8', '9', '10']);
  dragTop(); assert.deepEqual(ids(), ['5', '6', '7', '8', '9', '10']);
  dragTop(); assert.deepEqual(ids(), ['3', '4', '5', '6', '7', '8', '9', '10']);
  dragTop(); dragTop(); assert.equal(calls, 1);
  history = { ...history, loading: true }; render();
  assert.ok(h.hosts().some(node => node.type === 'Progress'));
  items = [{ id: '1' }, { id: '2' }, ...items]; history = { ...history, loading: false, cursor: 'second' };
  render(); resolveRead(); await Promise.resolve(); render();
  assert.equal(ids()[0], '1'); assert.equal(calls, 1);
  dragTop(); assert.equal(calls, 2); resolveRead(); await Promise.resolve(); await Promise.resolve(); render();
  dragTop(); assert.equal(calls, 2);
  const retry = h.hosts().find(node => node.props.label === '重新讀取較早對話');
  assert.ok(retry); retry.props.onPress(); render(); assert.equal(calls, 3);
  assert.ok(captures >= 4);
  assert.deepEqual(h.node('chat-timeline-scroll').props.maintainVisibleContentPosition, { minIndexForVisible: 1 });
  h.unmount(); delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame;
});

test('web history anchors the same message before paint, independently of footer height', () => {
  const h = harness();
  const { useChatReadingAnchor } = h.load('src/components/chat/useChatReadingAnchor.web.ts');
  let top = 25, firstId = 'old';
  const row = { getBoundingClientRect: () => ({ top, bottom: top + 100 }) };
  const viewport = { scrollTop: 100, getBoundingClientRect: () => ({ top: 20 }), querySelectorAll: () => [row], contains: node => node === row };
  const scroll = { current: { getScrollableNode: () => viewport } };
  let anchor;
  function Probe() { anchor = useChatReadingAnchor(scroll, firstId); return null; }
  h.render(h.jsx(Probe, {})); anchor.capture();
  top += 250; firstId = 'earlier'; h.render();
  assert.equal(viewport.scrollTop, 350);
  top += 70; h.render(); assert.equal(viewport.scrollTop, 350, 'one prepend is corrected only once');
  h.unmount();
});
