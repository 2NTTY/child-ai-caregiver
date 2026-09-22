import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { root, repo, modules, python, runtimeImport, runtimeRequire, skillDirectory, readJson, runPython, options, assertWithin } from './runtime.mjs';
import * as layouts from '../slides/layouts.mjs';

process.on('uncaughtException', error => { console.error(error.stack || error.message); process.exitCode = 1; });

const flags = options();
const sourceFile = (key, fallback) => flags[key] ? path.resolve(flags[key]) : path.join(root, fallback);
const [deck, content, status, theme] = await Promise.all([
  readJson(sourceFile('deck', 'deck.json')), readJson(sourceFile('content', 'content.json')),
  readJson(sourceFile('status', 'project-status.json')), readJson(sourceFile('theme', 'theme.json')),
]);
if (!deck.slides.length || new Set(deck.slides.map(s => s.id)).size !== deck.slides.length) throw new Error('Slide IDs must be unique and nonempty.');
for (const entry of deck.slides) if (!content[entry.id] || !layouts[entry.layout]) throw new Error(`Unknown slide content or layout: ${entry.id}`);
if (!/^[a-f0-9]{40}$/.test(status.baselineCommit) || !/^\d{4}-\d{2}-\d{2}$/.test(status.asOf)) throw new Error('Status requires a dated, exact Git baseline.');
if (status.demoUrl !== null && !/^https:\/\//.test(status.demoUrl)) throw new Error('Demo URL must be null or an explicit HTTPS URL.');
const finalDestination = flags.output ? path.resolve(flags.output) : path.join(root, 'output', deck.output);
assertWithin(root, finalDestination);
if (!finalDestination.endsWith('.pptx')) throw new Error('Output must be a PPTX file.');
const runDir = path.join(root, '.build', `run-${Date.now()}`);
await fs.mkdir(runDir, { recursive: true });
const { Presentation, PresentationFile } = await runtimeImport('@oai/artifact-tool');
const sharp = runtimeRequire('sharp');
const presentation = Presentation.create({ slideSize: theme.slide });
const images = [];
const authoredText = [];
const palette = theme.palette;
const color = (value) => palette[value] || value;
const inset = theme.spacing.margin;
const sx = (theme.slide.width - 2 * inset) / 1152;
const sy = (theme.slide.height - 2 * inset) / 592;
const geometry = (x, y, w, h) => ({ left: inset + (x - 64) * sx, top: inset + (y - 64) * sy, width: w * sx, height: h * sy });
function phaseLabel(scope) {
  const phases = scope.match(/P\d/g) || [];
  if (phases.length === 1) return `${scope} ${status.phaseLabels[phases[0]]}`;
  return `${scope} ${status.mixedPhaseLabel}`;
}

function helpers(slide, entry, index) {
  const text = (value, x, y, w, h, settings = {}) => {
    const size = (settings.size || theme.fontSize.body) * theme.fontScale * Math.min(sx, sy);
    const shape = slide.shapes.add({ geometry: 'textbox', name: `${entry.id}-text-${authoredText.length}`, position: geometry(x, y, w, h), fill: 'none', line: { fill: 'none', width: 0 } });
    shape.text = value;
    shape.text.style = { typeface: theme.font.family, fontSize: size, bold: !!settings.bold, color: color(settings.color || 'ink'), alignment: settings.align || 'left', verticalAlignment: 'top', wrap: 'square', autoFit: 'none', insets: { top: 0, right: 0, bottom: 0, left: 0 }, lineSpacing: 1.18 };
    authoredText.push({ slide: index + 1, text: value, x, y, w, h, size });
    return shape;
  };
  const rule = (x, y, w, h, shade = 'teal') => slide.shapes.add({ geometry: 'rect', position: geometry(x, y, w, h), fill: color(shade), line: { fill: 'none', width: 0 } });
  return {
    entry, status, theme, text, rule,
    heading() {
      text(content[entry.id].title, 72, 49, 1136, 70, { size: theme.fontSize.title, bold: true });
      if (entry.planned) text(phaseLabel(entry.planned), 865, 113, 340, 32, { size: 18, color: 'muted', align: 'right' });
    },
    frame(x, y, w, h) { return slide.shapes.add({ geometry: 'rect', position: geometry(x, y, w, h), fill: 'none', line: { fill: color('sage'), width: 2 } }); },
    lines(items, x, y, w, settings = {}) { items.forEach((item, i) => text(item, x, y + i * (settings.gap || 58), w, 60, settings)); },
    async art(relative, x, y, w, h, recolor = true, crop = null) {
      if (crop) crop = { left: 0, top: 0, right: 0, bottom: 0, ...crop };
      const box = geometry(x, y, w, h);
      const file = path.resolve(root, relative);
      assertWithin(repo, file);
      let bytes = await fs.readFile(file);
      const isSvg = file.toLowerCase().endsWith('.svg');
      if (isSvg && recolor) {
        let svg = bytes.toString('utf8');
        const pairs = Object.entries(theme.assetPalette).map(([name, original]) => [original, theme.palette[name] || original]);
        const map = new Map(pairs.map(([a, b]) => [a.toUpperCase(), b]));
        svg = svg.replace(/#[0-9a-fA-F]{6}\b/g, value => map.get(value.toUpperCase()) || value);
        bytes = Buffer.from(svg);
      }
      const meta = await sharp(bytes).metadata();
      const visibleWidth = meta.width * (1 - (crop?.left || 0) - (crop?.right || 0));
      const visibleHeight = meta.height * (1 - (crop?.top || 0) - (crop?.bottom || 0));
      const scale = Math.min(box.width / visibleWidth, box.height / visibleHeight);
      const width = visibleWidth * scale, height = visibleHeight * scale;
      const left = box.left + (box.width - width) / 2, top = box.top + (box.height - height) / 2;
      const fallback = await sharp(bytes).resize(Math.ceil(meta.width * scale * 2), Math.ceil(meta.height * scale * 2), { fit: 'contain' }).png().toBuffer();
      slide.images.add({ blob: fallback, contentType: 'image/png', alt: `${entry.id}: ${path.basename(file)}`, fit: 'contain', ...(crop ? { crop } : {}), position: { left, top, width, height } });
      if (isSvg) {
        const assetPath = path.join(runDir, `visual-${images.length + 1}.svg`);
        await fs.writeFile(assetPath, bytes);
        images.push({ slide: index + 1, svg: assetPath, source: path.relative(repo, file).replaceAll('\\', '/'), position: { left, top, width, height }, crop });
      } else images.push({ slide: index + 1, svg: null, source: relative, position: { left, top, width, height }, crop });
    },
  };
}

for (let index = 0; index < deck.slides.length; index++) {
  const entry = deck.slides[index];
  const slide = presentation.slides.add();
  slide.background.fill = palette.paper;
  await layouts[entry.layout](helpers(slide, entry, index), content[entry.id]);
  const copy = content[entry.id];
  const notes = [copy.notes, '', '來源：', ...(copy.refs || []), ...(entry.planned ? [`階段：${entry.planned}；已確認設計／規劃，不代表已實現。`] : []), ...(entry.layout === 'status' ? [status.evidenceNote, `查核基線：${status.baselineCommit}`, ...status.evidence] : [])];
  slide.speakerNotes.textFrame.setText(notes.join('\n'));
}
const sourcePptx = path.join(runDir, 'native.pptx');
await (await PresentationFile.exportPptx(presentation)).save(sourcePptx);
const imageMapPath = path.join(runDir, 'images.json');
await fs.writeFile(imageMapPath, JSON.stringify(images, null, 2));
const candidatePath = path.join(runDir, 'candidate.pptx');
runPython([path.join(root, 'scripts/package_tools.py'), 'embed', sourcePptx, candidatePath, imageMapPath]);

const skill = skillDirectory();
const { finalizePresentation } = await import(pathToFileURL(path.join(skill, 'container_tools/artifact_tool_utils.mjs')).href);
const validated = path.join(runDir, 'final', 'validated.pptx');
await fs.mkdir(path.dirname(validated), { recursive: true });
const validation = await finalizePresentation({
  workspaceDir: root, candidatePath, finalPath: validated,
  pythonExecutable: python,
  integrityValidatorPath: path.join(skill, 'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath: path.join(skill, 'container_tools/inspect_presentation_layout_geometry.py'),
  explicitTotalSlideCount: deck.slides.length,
  layoutArgs: ['--expected-slide-size-emu', `${theme.slide.width * 9525},${theme.slide.height * 9525}`, '--validate-heading-fit'],
  fontPolicy: { basis: 'user_request', families: [theme.font.family] },
  verifyArtifactToolImport: true,
  receiptPath: path.join(runDir, 'validation.json'),
});
await fs.mkdir(path.dirname(finalDestination), { recursive: true });
await fs.copyFile(validated, finalDestination);
const record = {
  generatedFile: path.relative(root, finalDestination).replaceAll('\\', '/'),
  slideIds: deck.slides.map(s => s.id), statusSnapshot: status, theme,
  imageSources: images.map(({ slide, source }) => ({ slide, source })),
  nativeText: authoredText, baseline: status.baselineCommit,
  sha256: createHash('sha256').update(await fs.readFile(finalDestination)).digest('hex'),
  runtime: { node: process.version, artifactTool: '2.8.59', modules },
  finalizerReceipt: path.relative(root, path.join(runDir, 'validation.json')).replaceAll('\\', '/'),
};
await fs.writeFile(path.join(runDir, 'build-record.json'), JSON.stringify(record, null, 2));
await fs.writeFile(path.join(root, '.build/latest.json'), JSON.stringify({ runDir, pptx: finalDestination }, null, 2));
console.log(JSON.stringify({ output: finalDestination, slides: deck.slides.length, sha256: record.sha256, validation: !!validation, runDir }));
