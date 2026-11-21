import { readSpecialistPreview, type SpecialistPreviewFormat, type SpecialistPreviewLoader, type SpecialistPreviewSession } from "./specialist-artifact-preview-contract.ts";

const allowedElements = new Set(["main", "header", "h1", "h2", "p", "section", "ul", "li", "strong", "footer"]);
const droppedElements = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "template"]);

function filteredHtml(doc: Document, raw: string) {
  // A template is inert. Only text and known structure are copied, with no original attributes or URLs.
  const template = doc.createElement("template");
  template.innerHTML = raw;
  const main = template.content.querySelector("main");
  if (!main) throw new Error("Specialist HTML preview has no content");
  const output = doc.createElement("main");
  const copy = (from: Node, into: Node) => {
    for (const item of from.childNodes) {
      if (item.nodeType === 3) { into.appendChild(doc.createTextNode(item.textContent ?? "")); continue; }
      if (item.nodeType !== 1) continue;
      const tag = (item as Element).localName;
      if (droppedElements.has(tag)) continue;
      const container = allowedElements.has(tag) ? doc.createElement(tag) : null;
      if (container) into.appendChild(container);
      copy(item, container ?? into);
    }
  };
  copy(main, output);
  return '<!doctype html><html lang="zh-HK"><head><meta charset="utf-8"><title>草稿預覽</title>'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">'
    + "<style>body{font-family:sans-serif;max-width:960px;margin:24px auto;padding:0 16px;line-height:1.5;color:#1f2937}footer{margin-top:24px;font-size:12px;color:#6b7280}</style>"
    + "</head><body>" + output.outerHTML + "</body></html>";
}

/** Open synchronously so a user gesture can reserve the surface before loading private bytes. */
export function openSpecialistArtifactPreview(format: SpecialistPreviewFormat, _fileName: string,
  load: SpecialistPreviewLoader, current: () => boolean): SpecialistPreviewSession {
  const controller = new AbortController();
  const viewer = current() && typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
  let objectUrl: string | null = null;
  let release: ReturnType<typeof setTimeout> | null = null;
  const revoke = () => {
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    if (release) { clearTimeout(release); release = null; }
  };
  const close = () => { controller.abort(); revoke(); if (viewer && !viewer.closed) viewer.close(); };
  const ready = (async () => {
    if (!viewer || viewer.closed) throw new Error("瀏覽器未能開啟預覽視窗。請允許這個網站開啟新視窗後再試。");
    viewer.opener = null;
    viewer.document.body.textContent = "正在讀取草稿預覽…";
    const bytes = await readSpecialistPreview(format, load, controller.signal, () => current() && !viewer.closed);
    if (controller.signal.aborted || !current() || viewer.closed) throw new Error("Specialist preview scope changed");
    if (format === "pdf") {
      objectUrl = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: "application/pdf" }));
      viewer.location.replace(objectUrl);
      release = setTimeout(revoke, 120000);
    } else {
      const doc = viewer.document;
      doc.title = "草稿預覽";
      doc.documentElement.lang = "zh-HK";
      const frame = doc.createElement("iframe");
      frame.setAttribute("sandbox", "");
      frame.referrerPolicy = "no-referrer";
      frame.title = "專家文件草稿預覽";
      frame.style.cssText = "display:block;border:0;width:100%;height:100vh";
      frame.srcdoc = filteredHtml(doc, new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      doc.body.style.margin = "0";
      doc.body.replaceChildren(frame);
    }
    return "已開啟草稿預覽，尚未正式保存或發布。";
  })().catch(error => { close(); throw error; });
  return { close, ready };
}
