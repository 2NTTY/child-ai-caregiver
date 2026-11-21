import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('production provides the specialist preview action and the card passes the exact run', () => {
  const provider = readFileSync(new URL('../frontend/src/production/ProductionProvider.tsx', import.meta.url), 'utf8');
  const card = readFileSync(new URL('../frontend/src/components/agent/AgentRunView.tsx', import.meta.url), 'utf8');
  assert.match(provider, /agentActions:\s*\{[\s\S]*?\bopenSpecialistArtifact\b[\s\S]*?selectAgentRun:/);
  assert.match(card, /actions\.openSpecialistArtifact\?\.\(item\.id, run\.id\)/);
});

test('scope loss while loading closes the reserved window before any preview is revealed', async () => {
  const { openSpecialistArtifactPreview } = await import('../frontend/src/platform/specialist-artifact-preview.ts');
  let active = true, closed = false, opened = null, resolveRead;
  const viewer = {
    get closed() { return closed; },
    close() { closed = true; },
    document: { body: { textContent: '' } },
    location: { replace(url) { opened = url; } },
  };
  const original = globalThis.window;
  globalThis.window = { open: () => viewer };
  try {
    const preview = openSpecialistArtifactPreview('pdf', 'draft.pdf',
      () => new Promise(resolve => { resolveRead = resolve; }), () => active);
    active = false;
    resolveRead({ bytes: new Uint8Array([37, 80, 68, 70, 45]), contentType: 'application/pdf' });
    await assert.rejects(preview.ready);
    assert.equal(closed, true);
    assert.equal(opened, null);
    assert.equal(viewer.opener, null);
  } finally {
    globalThis.window = original;
  }
});

test('mismatched PDF bytes cannot be opened as a browser document', async () => {
  const { openSpecialistArtifactPreview } = await import('../frontend/src/platform/specialist-artifact-preview.ts');
  let closed = false, opened = false;
  const viewer = {
    get closed() { return closed; },
    close() { closed = true; },
    document: { body: { textContent: '' } },
    location: { replace() { opened = true; } },
  };
  const original = globalThis.window;
  globalThis.window = { open: () => viewer };
  try {
    const preview = openSpecialistArtifactPreview('pdf', 'draft.pdf',
      async () => ({ bytes: new TextEncoder().encode('<html>not a PDF</html>'), contentType: 'application/pdf' }), () => true);
    await assert.rejects(preview.ready);
    assert.equal(closed, true);
    assert.equal(opened, false);
  } finally {
    globalThis.window = original;
  }
});

test('HTML preview copies only text and allowlisted structure into a zero-permission frame', async () => {
  const { openSpecialistArtifactPreview } = await import('../frontend/src/platform/specialist-artifact-preview.ts');
  const original = globalThis.window;
  const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const text = value => ({ nodeType: 3, textContent: value });
  const element = (tag, children = []) => ({
    nodeType: 1, localName: tag, childNodes: children, attrs: {}, style: {},
    appendChild(item) { this.childNodes.push(item); },
    setAttribute(key, value) { this.attrs[key] = value; },
    get outerHTML() {
      return '<' + tag + '>' + this.childNodes.map(c => c.nodeType === 3 ? escape(c.textContent) : c.outerHTML).join('') + '</' + tag + '>';
    },
  });
  const parsed = element('main', [
    element('h1', [text('草稿')]),
    element('a', [text('不能導向外站')]),
    element('script', [text('must-not-run')]),
    element('p', [text('<picture>')]),
  ]);
  parsed.childNodes[1].setAttribute('href', 'https://example.invalid');
  parsed.childNodes[0].setAttribute('id', 'external-id');
  const body = { style: {}, replaceChildren(frame) { this.frame = frame; } };
  let closed = false;
  const viewer = { get closed() { return closed; }, close() { closed = true; }, document: {
    body, documentElement: {}, createTextNode: text,
    createElement(tag) {
      return tag === 'template' ? { content: { querySelector: selector => selector === 'main' ? parsed : null } } : element(tag);
    },
  } };
  globalThis.window = { open: () => viewer };
  try {
    const preview = openSpecialistArtifactPreview('html', 'draft.html',
      async () => ({ bytes: new TextEncoder().encode('<main>fixture</main>'), contentType: 'text/html; charset=utf-8' }), () => true);
    assert.match(await preview.ready, /已開啟草稿預覽/u);
    assert.equal(body.frame.attrs.sandbox, '');
    assert.equal(body.frame.referrerPolicy, 'no-referrer');
    assert.match(body.frame.srcdoc, /default-src 'none'/);
    assert.match(body.frame.srcdoc, /<h1>草稿<\/h1>不能導向外站<p>&lt;picture&gt;<\/p>/u);
    assert.doesNotMatch(body.frame.srcdoc, /https:\/\/example\.invalid|external-id|must-not-run|<script|<a\s/u);
    preview.close();
    assert.equal(closed, true);
  } finally {
    globalThis.window = original;
  }
});


test('native preview does not load, share or cache a private draft without an in-app viewer', async () => {
  const source = readFileSync(new URL('../frontend/src/platform/specialist-artifact-preview.native.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /exportAttachment|shareAsync/, 'a preview must never hand a private draft to a save/share viewer');
  const { openSpecialistArtifactPreview } = await import('../frontend/src/platform/specialist-artifact-preview.native.ts');
  for (const format of ['pdf', 'html']) {
    let loaded = false;
    const preview = openSpecialistArtifactPreview(format, 'draft.' + format, async () => {
      loaded = true;
      throw new Error('unsupported native preview must not fetch');
    }, () => true);
    await assert.rejects(preview.ready, /請用網頁版預覽/u);
    preview.close();
    assert.equal(loaded, false);
  }
});
