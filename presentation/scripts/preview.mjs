import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, repo, runPython, runtimeRequire, options, readJson } from './runtime.mjs';

const flags = options();
const deck = await readJson(path.join(root, 'deck.json'));
const pptx = flags.pptx ? path.resolve(flags.pptx) : path.join(root, 'output', deck.output);
const output = path.join(root, '.build/preview');
const report = JSON.parse(runPython([path.join(root, 'scripts/package_tools.py'), 'preview', pptx, output]));
const { chromium } = runtimeRequire('playwright');
const sharp = runtimeRequire('sharp');
const edge = process.env.PRESENTATION_BROWSER || (process.platform === 'win32' ? path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe') : chromium.executablePath());
const browser = await chromium.launch({ executablePath: edge, headless: true, args: ['--disable-features=msEdgeSidebarV2'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(report.html).href);
  await page.evaluate(() => document.fonts.ready);
  report.overflows = await page.locator('.text').evaluateAll(elements => elements.filter(el => el.scrollHeight > el.clientHeight + 3 || el.scrollWidth > el.clientWidth + 3).map(el => ({ slide: Number(el.dataset.slide), text: el.textContent, width: el.clientWidth, height: el.clientHeight, contentWidth: el.scrollWidth, contentHeight: el.scrollHeight })));
  const thumbnails = [];
  for (let i = 1; i <= report.slides; i++) {
    const filename = path.join(output, `slide-${String(i).padStart(2, '0')}.png`);
    await page.evaluate(number => {
      document.querySelectorAll('.slide').forEach(el => { el.style.display = el.id === `slide-${number}` ? 'block' : 'none'; });
      window.scrollTo(0, 0);
    }, i);
    await page.locator(`#slide-${i}`).screenshot({ path: filename });
    thumbnails.push({ input: await sharp(filename).resize(384, 216).png().toBuffer(), left: ((i - 1) % 3) * 400, top: Math.floor((i - 1) / 3) * 240 });
  }
  await sharp({ create: { width: 1200, height: Math.ceil(report.slides / 3) * 240, channels: 3, background: '#DDE8DB' } }).composite(thumbnails).png().toFile(path.join(output, 'contact-sheet.png'));

  const assetReport = JSON.parse(runPython([path.join(root, 'scripts/package_tools.py'), 'assets', path.join(repo, 'assets')]));
  const assetPreviews = path.join(output, 'assets');
  await fs.mkdir(assetPreviews, { recursive: true });
  const bounds = [];
  for (const asset of assetReport.assets) {
    const source = path.join(repo, 'assets', asset.file);
    const filename = asset.file.replaceAll('/', '--').replace('.svg', '.png');
    await sharp(source).resize({ width: asset.file.includes('poster') ? 1188 : 1200 }).png().toFile(path.join(assetPreviews, filename));
    await page.goto(pathToFileURL(source).href);
    await page.evaluate(() => document.fonts.ready);
    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      if (root.localName !== 'svg') return ['Invalid SVG document'];
      const vb = root.viewBox.baseVal;
      return Array.from(root.querySelectorAll('text')).map(el => ({ text: el.textContent, box: el.getBBox() })).filter(({box}) => box.x < vb.x - 2 || box.y < vb.y - 2 || box.x + box.width > vb.x + vb.width + 2 || box.y + box.height > vb.y + vb.height + 2).map(({text}) => text);
    });
    if (overflow.length) bounds.push({ asset: asset.file, overflow });
  }
  report.svgTextOutsideViewBox = bounds;
  report.assetCount = assetReport.count;
  report.browser = 'Headless browser with a fresh temporary profile';
  report.desktopPowerPointVerified = false;
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ slides: report.slides, textOverflows: report.overflows.length, svgOutsideViewBox: bounds.length, output }));
  if (report.overflows.length || bounds.length) process.exitCode = 1;
} finally { await browser.close(); }
