import fs from 'node:fs/promises';
import path from 'node:path';
import { root, repo, runPython, readJson, options } from './runtime.mjs';

const flags = options();
const deck = await readJson(path.join(root, 'deck.json'));
const pptx = flags.pptx ? path.resolve(flags.pptx) : path.join(root, 'output', deck.output);
const tools = path.join(root, 'scripts/package_tools.py');
const assets = JSON.parse(runPython([tools, 'assets', path.join(repo, 'assets')]));
const presentation = JSON.parse(runPython([tools, 'inspect', pptx, String(deck.slides.length)]));
const report = { assets, presentation };
await fs.mkdir(path.join(root, '.build'), { recursive: true });
await fs.writeFile(path.join(root, '.build/checks.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ svg: assets.count, slides: presentation.slides, nativeTextShapes: presentation.slideDetails.reduce((n, s) => n + s.nativeTextShapes, 0), embeddedSvg: presentation.vectorImages, passed: true }));
