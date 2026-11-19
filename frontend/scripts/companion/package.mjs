// Rebuild after bundling render.js against CubismWebFramework 5-r.4 (see notices).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const [zip, corePath, rendererPath, frameworkDir, output] = process.argv.slice(2);
const core = readFileSync(corePath);
if (createHash('sha256').update(core).digest('hex') !== '25ae938cb4fe282ce189b357bcc97e603d1e1f7ec78bf04150d401c23cdc792f') throw Error('Unexpected Core');
const read = path => execFileSync('tar', ['-xOf', zip, 'runtime/' + path], {maxBuffer: 16 * 1024 * 1024});
const references = JSON.parse(read('zundamon.model3.json')).FileReferences;
const expression = name => references.Expressions.find(item => item.Name === name).File;
const assets = Object.fromEntries(Object.entries({ model: references.Moc, texture: references.Textures[0], physics: references.Physics,
  wave: 'motions/mtnBody_wave.motion3.json', smile: expression('exp_smile'), laugh: expression('exp_laugh') })
  .map(([name, file]) => [name, read(file).toString('base64')]));
const frameworkLicense = readFileSync(frameworkDir + '/LICENSE.md', 'utf8');
const script = (core.toString() + '\n;' + readFileSync(rendererPath, 'utf8')).replaceAll(/<\/script/gi, '<\\/script');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, '<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'wasm-unsafe-eval\'; style-src \'unsafe-inline\'; img-src data:"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{margin:0}html,body,canvas{width:100%;height:100%;overflow:hidden;display:block;background:transparent}</style></head><body><canvas></canvas><script type="application/json" id="assets">' + JSON.stringify(assets) + '</script><script>' + script + '</script><!-- Character: Tohoku Zunko & Zundamon Project / SSS LLC. Illustration: Sakamoto Ahiru. Model and Cubism SDK: Live2D Inc.\n' + frameworkLicense.replaceAll('--','—') + '\n--></body></html>');
