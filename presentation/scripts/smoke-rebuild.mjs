// Exercise the public JSON/build boundary without altering committed sources or the delivered deck.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, readJson, runPython } from './runtime.mjs';

const directory = path.join(root, '.build/source-smoke');
await fs.mkdir(directory, { recursive: true });
const latest = await fs.readFile(path.join(root, '.build/latest.json'));
const [deck, content, status, theme] = await Promise.all(['deck', 'content', 'project-status', 'theme'].map(file => readJson(path.join(root, `${file}.json`))));
const deliveredBefore = await fs.readFile(path.join(root, 'output', deck.output));
status.headline = '來源解耦測試';
status.phaseLabels.P2 = '已驗證';
content.problem.title = '單頁文案修改測試';
theme.palette.teal = '#6C526C';
theme.fontScale = 1.02;
theme.spacing.margin = 70;
[deck.slides[1], deck.slides[2]] = [deck.slides[2], deck.slides[1]];
deck.slides[0].asset = '../assets/illustrations/welcome.svg';
for (const [name, value] of Object.entries({ deck, content, status, theme })) await fs.writeFile(path.join(directory, `${name}.json`), JSON.stringify(value));
const output = path.join(directory, 'test.pptx');
try {
  const args = [path.join(root, 'scripts/build.mjs'), '--deck', path.join(directory, 'deck.json'), '--content', path.join(directory, 'content.json'), '--status', path.join(directory, 'status.json'), '--theme', path.join(directory, 'theme.json'), '--output', output];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  const packageTools = path.join(root, 'scripts/package_tools.py');
  const inspection = JSON.parse(runPython([packageTools, 'inspect', output, String(deck.slides.length)]));
  const text = inspection.slideDetails.flatMap(slide => slide.text).join('\n');
  if (!text.includes(status.headline) || !text.includes(content.problem.title) || !text.includes('P2 已驗證')) throw new Error('Content/status overrides did not reach editable PPTX text.');
  if (!inspection.slideDetails[1].text.includes(content.audience.title)) throw new Error('Deck order override was ignored.');
  const testLatest = await readJson(path.join(root, '.build/latest.json'));
  const record = await readJson(path.join(testLatest.runDir, 'build-record.json'));
  if (record.imageSources[0].source !== 'assets/illustrations/welcome.svg') throw new Error('Asset replacement was ignored.');
  if (record.theme.palette.teal !== theme.palette.teal || record.theme.spacing.margin !== 70) throw new Error('Theme override was ignored.');
  const deliveredAfter = await fs.readFile(path.join(root, 'output', deck.output));
  if (!deliveredBefore.equals(deliveredAfter)) throw new Error('Smoke test altered the delivered deck.');
  const report = { passed: true, checks: ['single-slide-copy', 'status-and-phase-label', 'slide-order', 'asset-replacement', 'theme-font-and-margin', 'delivered-output-preserved'], output: '.build/source-smoke/test.pptx' };
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await fs.writeFile(path.join(root, '.build/latest.json'), latest); }
