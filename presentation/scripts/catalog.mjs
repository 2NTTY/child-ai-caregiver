import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { root, repo, runtimeRequire, readJson, runPython } from './runtime.mjs';

// A static browsing index; all artwork stays in its independent source file.
const sharp = runtimeRequire('sharp');
const assetsRoot = path.join(repo, 'assets');
const prompts = await readJson(path.join(assetsRoot, 'image-prompts.json'));
const svgReport = JSON.parse(runPython([path.join(root, 'scripts/package_tools.py'), 'assets', assetsRoot]));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const decode = value => value.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'");
const title = (xml, tag) => decode(xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] || '').trim();
const imageTitles = ['港灣同行', '日常記錄', '照顧者交接', '課後陪伴', '赴約前整理', '晚間共讀'];
const images = [];
for (const [i, asset] of prompts.assets.entries()) {
  const data = await fs.readFile(path.join(assetsRoot, asset.file));
  const info = await sharp(data).metadata();
  if (info.format !== 'png' || !info.width || !info.height) throw new Error(`Invalid image: ${asset.file}`);
  images.push({ id: asset.id, title: imageTitles[i], file: asset.file, use: asset.use, alt: asset.alt, width: info.width, height: info.height, bytes: data.length, sha256: hash(data), promptId: asset.id, promptSha256: hash(asset.prompt) });
}
await fs.writeFile(path.join(assetsRoot, 'images/manifest.json'), JSON.stringify({
  source: 'Built-in ImageGen', generatedOn: '2026-09-22', synthetic: true,
  promptSource: '../image-prompts.json', promptAuthor: 'Astra Max subagent visual_brand',
  review: '逐張目視核對構圖、人物互動、照顧關係及明顯文字／UI；不是產品截圖。',
  note: '圖片是選定的生成成品；相同提示詞不保證逐像素重現。只在重新生圖並完成 review 後更新日期。', images
}, null, 2) + '\n');

const labels = { brand: '品牌', illustrations: '產品插圖', diagrams: '敘事與架構', promo: '宣傳', posters: '海報' };
let sections = '';
for (const [directory, label] of Object.entries(labels)) {
  let cards = '';
  for (const asset of svgReport.assets.filter(item => item.file.startsWith(`${directory}/`))) {
    const source = await fs.readFile(path.join(assetsRoot, asset.file), 'utf8');
    const png = `raster/${asset.file.replace(/\.svg$/, '.png')}`;
    await fs.access(path.join(assetsRoot, png));
    cards += `<article><a class="visual" href="${escape(asset.file)}"><img loading="lazy" src="${escape(asset.file)}" alt="${escape(title(source, 'desc'))}"></a><div class="copy"><h3>${escape(title(source, 'title') || asset.file)}</h3><p class="path">${escape(asset.file)}</p><p class="links"><a href="${escape(asset.file)}">SVG source</a><a href="${escape(png)}">PNG 匯出</a></p></div></article>`;
  }
  sections += `<section id="${directory}"><h2>${label}</h2><div class="grid ${directory === 'posters' ? 'poster' : ''}">${cards}</div></section>`;
}
const imageCards = images.map(asset => `<article><a class="visual image" href="${escape(asset.file)}"><img loading="lazy" src="${escape(asset.file)}" alt="${escape(asset.alt)}" width="${asset.width}" height="${asset.height}"></a><div class="copy"><h3>${escape(asset.title)}</h3><p>${escape(asset.use)}</p><p class="path">${asset.width} × ${asset.height} · ${escape(asset.file)}</p><p class="links"><a href="${escape(asset.file)}">PNG 成品</a><a href="image-prompts.json">提示詞 source</a></p></div></article>`).join('');

const deck = await readJson(path.join(root, 'deck.json'));
const preview = await readJson(path.join(root, '.build/preview/report.json'));
if (preview.slides !== deck.slides.length || preview.overflows.length || preview.svgTextOutsideViewBox.length) throw new Error('Preview must pass before publishing the catalog.');
const previewOutput = path.join(root, 'output/previews');
await fs.mkdir(previewOutput, { recursive: true });
let slideCards = '';
for (let i = 1; i <= preview.slides; i++) {
  const file = `slide-${String(i).padStart(2, '0')}.png`;
  await fs.copyFile(path.join(root, '.build/preview', file), path.join(previewOutput, file));
  const url = `../presentation/output/previews/${file}`;
  slideCards += `<article><a class="visual slide" href="${url}"><img loading="lazy" src="${url}" alt="簡報第 ${i} 頁預覽" width="1280" height="720"></a><div class="copy"><h3>${String(i).padStart(2, '0')} · ${escape(deck.slides[i - 1].id)}</h3></div></article>`;
}
await fs.copyFile(path.join(root, '.build/preview/contact-sheet.png'), path.join(previewOutput, 'contact-sheet.png'));
const pptxData = await fs.readFile(path.join(root, 'output', deck.output));
await fs.writeFile(path.join(previewOutput, 'manifest.json'), JSON.stringify({ generated: true, source: `../${deck.output}`, sha256: hash(pptxData), slides: preview.slides, method: preview.method, desktopPowerPointVerified: false, regenerate: 'npm --prefix presentation run preview; npm --prefix presentation run catalog' }, null, 2) + '\n');

const html = `<!doctype html>
<html lang="zh-HK"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>育伴港 · 素材總覽</title><style>
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#FAF7EF;color:#203E3A;font-family:"Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif;line-height:1.7}a{color:#287568;text-underline-offset:4px}a:focus-visible{outline:3px solid #C86D52;outline-offset:5px}header,main,footer{max-width:1280px;margin:auto;padding:40px 32px}header{padding-top:64px;padding-bottom:16px}.eyebrow{font-size:14px;letter-spacing:.15em}h1{font-size:clamp(32px,5vw,64px);line-height:1.25;margin:16px 0}h2{font-size:28px;margin:0 0 20px}h3{font-size:18px;margin:0 0 8px}p{margin:8px 0}.lead{max-width:850px;font-size:18px}.stats{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0}.stats span{background:#DDE8DB;border-radius:24px;padding:7px 18px}nav{display:flex;flex-wrap:wrap;gap:12px 24px;border-block:1px solid #DDE8DB;padding:16px 0}section{margin:24px 0 64px;scroll-margin-top:24px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}.grid.images{grid-template-columns:repeat(2,minmax(0,1fr))}article{overflow:hidden;border:1px solid #DDE8DB;border-radius:18px;background:white}.visual{display:flex;justify-content:center;align-items:center;background:#F3F2E9;height:230px;padding:20px}.visual img{display:block;width:100%;height:100%;object-fit:contain}.visual.image,.visual.slide{height:auto;padding:0}.visual.image img,.visual.slide img{height:auto;object-fit:contain}.copy{padding:18px 22px}.path{font:12px/1.6 ui-monospace,monospace;overflow-wrap:anywhere;color:#60756E}.links{display:flex;gap:20px}.poster{grid-template-columns:minmax(280px,500px)}.poster .visual{height:590px}.notice{background:#DDE8DB;border-radius:16px;padding:18px 24px;margin-bottom:24px}footer{color:#60756E;font-size:14px;padding-top:0}@media(max-width:850px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){header,main,footer{padding-left:20px;padding-right:20px}.grid,.grid.images{grid-template-columns:1fr}.poster .visual{height:auto}.poster img{height:auto}}
</style></head><body><header><p class="eyebrow">育伴港 · VISUAL SOURCE LIBRARY</p><h1>為下一步，留一點光。</h1><p class="lead">為香港 0–10 歲孩子的成年照顧者，預先準備可持續修改的品牌、插圖、敘事圖及簡報素材。這裏的概念畫面與規劃能力，尚未整合成產品。</p><div class="stats"><span>22 SVG source</span><span>6 生成插畫</span><span>22 PNG 匯出</span><span>13 頁可編輯簡報</span></div><nav aria-label="素材類別"><a href="#brand">品牌</a><a href="#illustrations">產品插圖</a><a href="#diagrams">架構／流程</a><a href="#promo">宣傳</a><a href="#posters">海報</a><a href="#images">生活插畫</a><a href="#slides">簡報</a><a href="README.md">使用說明</a></nav></header><main>${sections}<section id="images"><h2>家庭生活插畫</h2><p class="notice">虛構家庭的生成插畫，不是真實家庭影像或產品畫面。選定 PNG 與完整提示詞分開保存，適合在其上另加可編輯文案。</p><div class="grid images">${imageCards}</div></section><section id="slides"><h2>簡報 · 13 個清楚訊息</h2><p class="notice"><a href="../presentation/output/${escape(deck.output)}">開啟 PowerPoint 成品</a> · <a href="../presentation/README.md">修改與重建方法</a><br>下列預覽由最終 PPTX 的文字、圖片及座標在瀏覽器重建，供目視檢查；未代替桌面 PowerPoint 開啟驗收。</p><div class="grid">${slideCards}</div></section></main><footer>本頁為 generated 靜態索引；由 presentation/scripts/catalog.mjs 重建。圖形 source 各自獨立，現況只以 presentation/project-status.json 的基線 snapshot 為準。沒有外部字體、分析追蹤或網絡依賴。</footer></body></html>`;
await fs.writeFile(path.join(assetsRoot, 'index.html'), html);
console.log(JSON.stringify({ svg: svgReport.count, images: images.length, slides: preview.slides, catalog: 'assets/index.html', pptxSha256: hash(pptxData) }));
