import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const production = (name, file) => readFileSync(path.join(path.dirname(require.resolve(`${name}/package.json`)), 'cjs', file), 'utf8');
// Use the installed React build and actual hook. Only the message content and
// ScrollView ref adapter are synthetic; geometry and scroll anchoring are native.
const modules = {
  react: production('react', 'react.production.js'),
  scheduler: production('scheduler', 'scheduler.production.js'),
  'react-dom': production('react-dom', 'react-dom.production.js'),
  'react-dom/client': production('react-dom', 'react-dom-client.production.js'),
  anchor: ts.transpileModule(readFileSync(new URL('../src/components/chat/useChatReadingAnchor.web.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
};
let browser;
test.before(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: 'msedge' }) });
});
test.after(async () => { await browser?.close(); });

async function fixture({ width, zoom, nestedZoom = 1, overflowAnchor = 'auto' }) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.route('**/*', route => route.abort());
  await page.setContent(`<!doctype html><html style="zoom:${zoom}"><style>
    * { box-sizing: border-box; } body { margin:0; }
    #root { zoom:${nestedZoom}; width:calc(100% - 20px); max-width:627px; margin:20px 10px; }
    #viewport { overflow-y:auto; height:301.375px; border:1.25px solid black; position:relative; overflow-anchor:${overflowAnchor}; }
    #content { display:flex; flex-direction:column; gap:28px; padding:20px 16px 60px; }
    [data-testid="chat-timeline-entry"] { flex-shrink:0; border:1px solid #ccc; padding:7px; }
  </style><main id="root"></main></html>`);
  await page.evaluate(modules => {
    const cache = {};
    function load(name) {
      if (cache[name]) return cache[name].exports;
      const module = { exports: {} }; cache[name] = module;
      new Function('require', 'module', 'exports', modules[name])(load, module, module.exports);
      return module.exports;
    }
    const React = load('react'), { flushSync } = load('react-dom'), { createRoot } = load('react-dom/client');
    const { useChatReadingAnchor } = load('anchor');
    const h = React.createElement;
    let control;
    function Probe() {
      const [first, setFirst] = React.useState(12), [footerHeight, setFooterHeight] = React.useState(30);
      const scroll = React.useRef(null), anchor = useChatReadingAnchor(scroll, String(first));
      control = { anchor, first, setFirst, setFooterHeight };
      return h('div', { id: 'viewport', tabIndex: 0, ref: node => { scroll.current = node ? { getScrollableNode: () => node } : null; } },
        h('div', { id: 'content' }, h('div', { style: { height: 56, flexShrink: 0 } }, 'Synthetic history status'),
          Array.from({ length: 18 - first }, (_, i) => first + i).map(id => h('div', { key: id, id: `row-${id}`, 'data-testid': 'chat-timeline-entry', style: { minHeight: id % 2 ? 133.25 : 69.375 } }, `Synthetic message ${id}`)),
          h('div', { id: 'footer', style: { height: footerHeight, flexShrink: 0 } }, 'Synthetic streaming footer')));
    }
    const root = createRoot(document.getElementById('root'));
    flushSync(() => root.render(h(Probe)));
    const viewport = document.getElementById('viewport');
    viewport.scrollTop = 130;
    window.fixture = {
      capture: () => control.anchor.capture(), cancel: () => control.anchor.cancel(),
      prepend: () => flushSync(() => { control.setFirst(control.first - 6); control.setFooterHeight(430); }),
      footer: () => flushSync(() => control.setFooterHeight(630)),
      read() {
        const top = viewport.getBoundingClientRect().top;
        const node = [...viewport.querySelectorAll('[data-testid="chat-timeline-entry"]')].find(node => node.getBoundingClientRect().bottom > top);
        return { id: node.id, offset: node.getBoundingClientRect().top - top, y: viewport.scrollTop, height: viewport.scrollHeight };
      },
      offset: id => document.getElementById(id).getBoundingClientRect().top - viewport.getBoundingClientRect().top,
      scroll: y => { viewport.scrollTop = y; },
      unmount: () => flushSync(() => root.unmount()),
    };
  }, modules);
  return page;
}

for (const configuration of [
  { width: 1440, zoom: 1 },
  { width: 1024, zoom: 1.4 },
  { width: 390, zoom: 1.4, nestedZoom: 1.25 },
  { width: 320, zoom: 0.8, overflowAnchor: 'none' },
]) {
  test(`preserves a partial message across repeated prepends at ${JSON.stringify(configuration)}`, async t => {
    const page = await fixture(configuration);
    try {
      for (let pageIndex = 0; pageIndex < 2; pageIndex++) {
        const { before, immediate } = await page.evaluate(() => {
          const before = fixture.read(); fixture.capture(); fixture.prepend();
          return { before, immediate: fixture.offset(before.id) };
        });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const settled = await page.evaluate(id => fixture.offset(id), before.id);
        t.diagnostic(JSON.stringify({ pageIndex, before, immediateShift: immediate - before.offset, settledShift: settled - before.offset }));
        assert.ok(Math.abs(immediate - before.offset) <= 1, `before-paint shift ${immediate - before.offset}px`);
        assert.ok(Math.abs(settled - before.offset) <= 1, `settled shift ${settled - before.offset}px`);
        const reading = await page.evaluate(() => { const reading = fixture.read(); fixture.footer(); return reading; });
        assert.ok(Math.abs(await page.evaluate(id => fixture.offset(id), reading.id) - reading.offset) <= 1, 'footer updates must not replay the prepend correction');
      }
    } finally { await page.close(); }
  });
}
