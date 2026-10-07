import { createElement as h } from "react";
import { fileURLToPath } from "node:url";
import { Document, Page, Text, View, Font, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { DocumentSnapshot, DocumentExport } from "../src/shared/family-documents.ts";

Font.register({ family: "YubanTC", src: fileURLToPath(new URL("./assets/fonts/LXGWWenKaiTC-Regular.ttf", import.meta.url)) });
const style = StyleSheet.create({
  page: { fontFamily: "YubanTC", fontSize: 11, lineHeight: 1.55, padding: 38, paddingBottom: 52, color: "#243b32" },
  title: { fontSize: 21, marginBottom: 10 }, heading: { fontSize: 15, marginTop: 13, marginBottom: 6 },
  small: { fontSize: 9, color: "#52615b", marginBottom: 5 }, item: { marginBottom: 7 },
  footer: { position: "absolute", bottom: 24, left: 38, right: 38, fontSize: 9, color: "#52615b" },
});
const purposeLabels = { family: "家庭成長", appointment: "就診溝通", handoff: "照護交接", school: "入園認識" };

/** Takes an already-authorized exact snapshot. The route rechecks it after rendering. */
export async function renderFamilyDocumentPdf(snapshot: DocumentSnapshot, options: DocumentExport): Promise<Buffer> {
  if (snapshot.id !== options.snapshotId || snapshot.version !== options.snapshotVersion) throw new Error("document_snapshot_changed");
  const text = (value: string, small = false) => h(Text, { style: small ? style.small : style.item }, value);
  return renderToBuffer(h(Document, { title: snapshot.title, author: "育伴港", subject: "家庭資料整理；非醫療或發展評估" },
    h(Page, { size: "A4", style: style.page, wrap: true },
      h(Text, { style: style.title }, snapshot.title),
      text(`${purposeLabels[options.purpose]} · 版本 ${snapshot.version} · ${snapshot.period.from} 至 ${snapshot.period.to}`, true),
      text(`${snapshot.ageLabel} · 整理時間 ${snapshot.generatedAt}`, true),
      // The fixed CJK coverage has no spaces; sentence breaks prevent an unbreakable off-page run.
      text(snapshot.coverageNote.replace(/。(?=.)/gu, "。\n"), true), text(snapshot.summary),
      ...snapshot.sections.map(section => h(View, { key: section.id },
        h(Text, { style: style.heading, minPresenceAhead: 35 }, section.title),
        ...section.items.map(item => h(Text, { key: item.id, style: style.item, orphans: 2, widows: 2 },
          (section.kind === "checklist" ? item.checked ? "[已核對] " : "[待核對] " : "") + item.text)),
      )),
      ...(options.includeRevision ? [h(Text, { key: "changes-title", style: style.heading }, "本版更新"),
        ...snapshot.changes.map((value, index) => h(Text, { key: `change-${index}`, style: style.small }, value))] : []),
      ...(options.includeSources ? [h(Text, { key: "sources-title", style: style.heading }, "原始資料及依據"),
        ...snapshot.sources.map(source => h(View, { key: source.id },
          text(`${source.label} · 版本 ${source.version} · ${source.at ?? "事件時間未知"}`, true), text(source.text),
        ))] : []),
      h(Text, { style: style.footer, fixed: true, render: ({ pageNumber, totalPages }) =>
        `育伴港 · 家庭共享資料整理，非診斷或發展評估 · ${pageNumber} / ${totalPages}` }),
    )));
}

