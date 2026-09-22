import fs from 'node:fs/promises';
import path from 'node:path';
import { root, repo, runPython, runtimeRequire } from './runtime.mjs';

const sharp = runtimeRequire('sharp');
const check = JSON.parse(runPython([path.join(root, 'scripts/package_tools.py'), 'assets', path.join(repo, 'assets')]));
const exports = [];
for (const asset of check.assets) {
  const input = path.join(repo, 'assets', asset.file);
  const relative = asset.file.replace(/\.svg$/, '.png');
  const output = path.join(repo, 'assets/raster', relative);
  await fs.mkdir(path.dirname(output), { recursive: true });
  const width = asset.file.includes('project-poster') ? 2376 : asset.file.startsWith('brand/') ? 1024 : asset.file.startsWith('illustrations/') ? 1280 : 2400;
  const info = await sharp(input).resize({ width }).png().toFile(output);
  exports.push({ source: asset.file, output: `raster/${relative}`, width: info.width, height: info.height, bytes: info.size });
}
await fs.writeFile(path.join(repo, 'assets/raster/manifest.json'), JSON.stringify({ generated: true, generator: 'npm --prefix presentation run export:assets', assets: exports }, null, 2));
console.log(JSON.stringify({ svgSources: check.count, pngExports: exports.length }));
