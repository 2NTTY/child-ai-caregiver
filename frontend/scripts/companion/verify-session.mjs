// Run against this worktree's running, zero-model local agent.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const local = JSON.parse(readFileSync(new URL('../../../.cache/agent-local/state.json', import.meta.url), 'utf8'));
const project = /^demo-yuyf-([a-f0-9]{8})$/.exec(local.projectId);
assert(project, 'Expected a local emulator project');
const port = 17000 + parseInt(project[1].slice(0, 4), 16) % 2500 * 10;
const origin = 'http://127.0.0.1:' + port;
const browser = await chromium.launch({
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: 'msedge' }),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let initialisations = 0;
  await page.exposeBinding('recordModelCreation', () => { initialisations++; });
  // Observe the SDK's successful allocation, independently of ready/status messages and HTTP cache.
  await page.addInitScript(() => {
    if (location.pathname !== '/companion/zundamon.html') return;
    let core;
    Object.defineProperty(window, 'Live2DCubismCore', {
      configurable: true, get: () => core,
      set(namespace) {
        core = namespace;
        let Model;
        Object.defineProperty(core, 'Model', {
          configurable: true, get: () => Model,
          set(klass) {
            Model = klass;
            const fromMoc = klass.fromMoc;
            klass.fromMoc = function (...args) {
              const model = fromMoc.apply(this, args);
              if (model) {
                window.allocatedModel = model;
                window.modelUpdates = 0;
                const update = model.update;
                model.update = function (...args) { window.modelUpdates++; return update.apply(this, args); };
                void window.recordModelCreation();
              }
              return model;
            };
          },
        });
      },
    });
  });
  await page.goto(origin + '/login');
  await page.getByTestId('frontend-preview-ready').waitFor();
  const login = page.getByRole('button', { name: '登入', exact: true });
  await login.click({ trial: true });
  await page.getByLabel('電郵地址', { exact: true }).fill(local.email);
  await page.getByLabel('密碼', { exact: true }).fill(local.password);
  await login.click();
  const figure = page.locator('iframe[title="Zundamon"]');
  let original, frame, firstTask = true;
  for (const path of ['/tasks', '/chat', '/growth', '/tasks']) {
    await page.locator(`a[href="${path}"]:visible`).first().click();
    await page.waitForURL(origin + path);
    await page.getByTestId('site-companion').click({ trial: true });
    assert.equal(await figure.count(), 1);
    if (!original) {
      original = await figure.elementHandle();
      frame = await original.contentFrame();
      await frame.waitForFunction(() => !!window.allocatedModel);
      await frame.evaluate(() => {
        window.firstModel = window.allocatedModel;
        window.firstContext = document.querySelector('canvas').getContext('webgl');
      });
    }
    assert(await figure.evaluate((element, saved) => element === saved, original), 'The original iframe stays mounted');
    assert.equal(await original.contentFrame(), frame);
    assert(await frame.evaluate(() => window.firstModel === window.allocatedModel &&
      window.firstContext === document.querySelector('canvas').getContext('webgl')));
    assert.equal(initialisations, 1, 'Exactly one Cubism model for the signed-in session');
    if (path === '/tasks' && firstTask) {
      firstTask = false;
      await page.getByTestId('companion-head').click();
    } else if (path === '/chat') {
      const updates = await frame.evaluate(() => window.modelUpdates);
      await frame.waitForFunction(start => window.modelUpdates >= start + 5, updates, { timeout: 2000 });
      // The inherited nod finishes; the quiet page then stops drawing idle frames.
      await page.waitForTimeout(4100);
      const settled = await frame.evaluate(() => window.modelUpdates);
      await page.waitForTimeout(240);
      assert.equal(await frame.evaluate(() => window.modelUpdates), settled);
    }
  }
  console.log('PASS one iframe, Cubism model and WebGL context across four route visits');
} finally {
  await browser.close();
}
