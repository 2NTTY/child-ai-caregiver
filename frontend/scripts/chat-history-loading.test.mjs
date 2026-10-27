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
  const viewport = {
    scrollTop: 100, getBoundingClientRect: () => ({ top: 20, height: 300 }), querySelectorAll: () => [row], contains: node => node === row,
    ownerDocument: { defaultView: { getComputedStyle: () => ({ height: '300px', boxSizing: 'border-box' }) } },
  };
  const scroll = { current: { getScrollableNode: () => viewport } };
  let anchor;
  function Probe() { anchor = useChatReadingAnchor(scroll, firstId); return null; }
  h.render(h.jsx(Probe, {})); anchor.capture();
  top += 250; firstId = 'earlier'; h.render();
  assert.equal(viewport.scrollTop, 350);
  top += 70; h.render(); assert.equal(viewport.scrollTop, 350, 'one prepend is corrected only once');
  h.unmount();
});

function readingAnchorFixture({ scale = 1, boxSizing = 'border-box' } = {}) {
  const h = harness();
  const { useChatReadingAnchor } = h.load('src/components/chat/useChatReadingAnchor.web.ts');
  let contentTop = 88.25, firstId = 'old', attached = true, anchor;
  const top = 20.5, height = 301.375;
  const style = { height: `${height}px`, boxSizing, paddingTop: '7.25px', paddingBottom: '5.5px', borderTopWidth: '1.25px', borderBottomWidth: '0.75px' };
  const borderBoxHeight = height + (boxSizing === 'border-box' ? 0 : 14.75);
  const viewport = {
    scrollTop: 100,
    // offsetHeight/clientHeight round layout values; using them as a scale
    // denominator introduces drift on fractional flex-sized viewports.
    offsetHeight: Math.round(borderBoxHeight), clientHeight: Math.round(borderBoxHeight - 2),
    ownerDocument: { defaultView: { getComputedStyle: () => style } },
    getBoundingClientRect: () => ({ top, height: borderBoxHeight * scale }),
    querySelectorAll: () => [row], contains: node => attached && node === row,
  };
  const row = { getBoundingClientRect: () => ({ top: top + (contentTop - viewport.scrollTop) * scale, bottom: top + (contentTop + 100 - viewport.scrollTop) * scale }) };
  const scroll = { current: { getScrollableNode: () => viewport } };
  function Probe() { anchor = useChatReadingAnchor(scroll, firstId); return null; }
  h.render(h.jsx(Probe, {}));
  return {
    viewport,
    offset: () => row.getBoundingClientRect().top - top,
    capture: () => anchor.capture(), cancel: () => anchor.cancel(),
    prepend(amount, browserAlreadyAnchored = false) {
      contentTop += amount; firstId = `before-${firstId}`;
      if (browserAlreadyAnchored) viewport.scrollTop += amount;
      h.render();
    },
    detach: () => { attached = false; },
    render: () => h.render(), unmount: () => h.unmount(),
  };
}

test('web history converts scaled rectangles to fractional scroll units for each prepend', () => {
  for (const scale of [1, 1.4, 0.8, 1.4 * 1.25]) {
    for (const boxSizing of ['border-box', 'content-box']) {
      const f = readingAnchorFixture({ scale, boxSizing });
      try {
        for (const addedHeight of [800.875, 249.375]) {
          const offset = f.offset(), y = f.viewport.scrollTop;
          f.capture(); f.prepend(addedHeight);
          assert.ok(Math.abs(f.offset() - offset) < 0.001, `${scale} ${boxSizing}: the same partial message must retain its viewport offset`);
          assert.ok(Math.abs(f.viewport.scrollTop - y - addedHeight) < 0.001, 'scrollTop must receive layout pixels, not scaled visual pixels');
          f.render(); assert.equal(f.viewport.scrollTop, y + addedHeight, 'unrelated footer render cannot repeat the correction');
        }
      } finally { f.unmount(); }
    }
  }
});

test('web history respects browser anchoring, recaptured reader position, cancellation and detached rows', () => {
  const f = readingAnchorFixture({ scale: 1.4 });
  try {
    const original = f.offset(); f.capture(); f.prepend(200.25, true);
    assert.ok(Math.abs(f.offset() - original) < 0.001, 'native browser anchoring must not be applied twice');
    f.capture(); f.viewport.scrollTop += 20.5; f.capture(); const moved = f.offset(); f.render();
    f.prepend(300.75); assert.ok(Math.abs(f.offset() - moved) < 0.001, 'a pending read uses the latest explicit reader position');
    f.capture(); f.cancel(); const canceledY = f.viewport.scrollTop;
    f.prepend(100); assert.equal(f.viewport.scrollTop, canceledY);
    f.capture(); f.detach(); f.prepend(100); assert.equal(f.viewport.scrollTop, canceledY, 'detached old-scope messages cannot reposition a new list');
  } finally { f.unmount(); }
});
