import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';

test('the packaged character keeps its ears, hands and shoes inside the canvas during nods and waves', async () => {
  const browser = await chromium.launch({
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: 'msedge' }),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 152, height: 214 } });
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, options) {
        return original.call(this, type, type === 'webgl' ? { ...options, preserveDrawingBuffer: true } : options);
      };
      window.addEventListener('message', event => {
        if (event.data?.companion === 'ready') document.documentElement.dataset.ready = 'yes';
      });
    });
    await page.goto(new URL('../../public/companion/zundamon.html', import.meta.url).href);
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'yes');
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    // Consecutive gestures exercise both expressions. Read the shipped WebGL output.
    for (const action of ['nod', 'wave', 'wave']) {
      await page.evaluate(action => window.postMessage(action, '*'), action);
      for (let tick = 0; tick < 19; tick++) {
        await page.clock.runFor(250);
        const bounds = await page.evaluate(() => {
          const canvas = document.querySelector('canvas'), gl = canvas.getContext('webgl');
          const { width, height } = canvas, pixels = new Uint8Array(width * height * 4);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let visible = 0, margin = Infinity;
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              if (pixels[(y * width + x) * 4 + 3] < 64) continue;
              visible++;
              margin = Math.min(margin, x, y, width - x - 1, height - y - 1);
            }
          }
          return { visible, margin };
        });
        assert(bounds.visible > 0 && bounds.margin >= 2, `${action} frame ${tick} must keep the visible character inside all four edges`);
      }
    }
  } finally {
    await browser.close();
  }
});
