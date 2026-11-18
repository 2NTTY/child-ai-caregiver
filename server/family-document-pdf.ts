import { createElement as h } from "react";
import { fileURLToPath } from "node:url";
import { Document, Page, Text, View, Font, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { projectDocumentExport } from "../src/shared/document-export-view.ts";
import type { DocumentSnapshot, DocumentExport } from "../src/shared/family-documents.ts";

Font.register({ family: "YubanTC", src: fileURLToPath(new URL("./assets/fonts/LXGWWenKaiTC-Regular.ttf", import.meta.url)) });
const style = StyleSheet.create({
  page: { fontFamily: "YubanTC", fontSize: 11, lineHeight: 1.55, padding: 38, paddingBottom: 52, color: "#243b32" },
  title: { fontSize: 21, marginBottom: 10 }, heading: { fontSize: 15, marginTop: 13, marginBottom: 6 },
  small: { fontSize: 9, color: "#52615b", marginBottom: 5 }, item: { marginBottom: 7 },
  // Use natural font leading: zero survives dynamic relayout without multiplying inherited lineHeight.
  footer: { lineHeight: 0, position: "absolute", bottom: 24, left: 38, right: 38, fontSize: 9, color: "#52615b" },
});

/** Takes an already-authorized exact snapshot. The route rechecks it after rendering. */
export async function renderFamilyDocumentPdf(snapshot: DocumentSnapshot, options: DocumentExport): Promise<Buffer> {
  const view = projectDocumentExport(snapshot, options);
  const text = (value: string, small = false) => h(Text, { style: small ? style.small : style.item }, value);
  return renderToBuffer(h(Document, { title: view.title, author: "育伴港", subject: "家庭資料整理；非醫療或發展評估" },
    h(Page, { size: "A4", style: style.page, wrap: true },
      h(Text, { style: style.title }, view.title),
      text(view.subtitle, true),
      text(view.metadata, true),
      // The fixed CJK coverage has no spaces; sentence breaks prevent an unbreakable off-page run.
      text(view.coverageNote.replace(/。(?=.)/gu, "。\n"), true), text(view.summary),
      ...view.sections.map((section, index) => h(View, { key: "section-" + index },
        h(Text, { style: style.heading, minPresenceAhead: 35 }, section.title),
        ...section.items.map((item, i) => h(Text, { key: i, style: style.item, orphans: 2, widows: 2 },
          item)),
      )),
      ...(view.changes ? [h(Text, { key: "changes-title", style: style.heading }, "本版更新"),
        ...view.changes.map((value, index) => h(Text, { key: `change-${index}`, style: style.small }, value))] : []),
      ...(view.sources ? [h(Text, { key: "sources-title", style: style.heading }, "原始資料及依據"),
        ...view.sources.map((source, i) => h(View, { key: "source-" + i },
          text(source.label, true), text(source.text),
        ))] : []),
      h(Text, { style: style.footer, fixed: true, render: ({ pageNumber, totalPages }) =>
        `育伴港 · 家庭共享資料整理，非診斷或發展評估 · ${pageNumber} / ${totalPages}` }),
    )));
}

