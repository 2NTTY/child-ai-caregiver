import { useRef, useState } from "react";
import { applyMemoryPreviewWrite, canManageMemory, type FactEditorMode, type MemoryEditor, type MemoryFactView, type MemoryPreviewWrite, type MemoryRole, type MemoryTopicView, type TopicEditorMode } from "../memory-view-model";
import { createMemoryFixture } from "./memory-fixture";
import { usePreviewOperation } from "./usePreviewOperation";

export interface MemoryConflict { original: MemoryFactView | MemoryTopicView; latest: MemoryFactView | MemoryTopicView }
export function useMemoryPreview(childId: string, role: MemoryRole, sourceChanged: boolean, expired: boolean) {
  const [fixture] = useState(() => createMemoryFixture(childId, sourceChanged, expired));
  const [data, setData] = useState(fixture.data);
  const [editor, setEditor] = useState<MemoryEditor | null>(null);
  const [conflict, setConflict] = useState<MemoryConflict | null>(null);
  const [history, setHistory] = useState<{ kind: "fact" | "topic"; id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const controller = usePreviewOperation();
  const blocked = controller.locked || controller.operation.state === "conflict";
  function begin(next: MemoryEditor) {
    if (blocked || next.basis && !canManageMemory(role, next.basis)) return;
    controller.reset(); if (!next.basis && controller.outcome === "conflict") controller.setOutcome("success");
    setEditor(next); setConflict(null); setError(null); setHistory(null);
  }
  function simulateConflict(basis: MemoryFactView | MemoryTopicView) {
    if ("key" in basis) {
      const latest: MemoryFactView = { ...basis, content: `${basis.content}（另一位照顧者的合成補充）`, version: basis.version + 1, reason: "合成並行更正" };
      setData(previous => ({ ...previous, summary: null, facts: previous.facts.map(item => item.id === basis.id ? latest : item), factVersions: { ...previous.factVersions, [basis.id]: [latest, ...(previous.factVersions[basis.id] ?? [])] } }));
      setConflict({ original: basis, latest });
    } else {
      const latest: MemoryTopicView = { ...basis, note: "另一位照顧者已補充備註（合成）。", version: basis.version + 1 };
      setData(previous => ({ ...previous, summary: null, topics: previous.topics.map(item => item.id === basis.id ? latest : item), topicVersions: { ...previous.topicVersions, [basis.id]: [latest, ...(previous.topicVersions[basis.id] ?? [])] } }));
      setConflict({ original: basis, latest });
    }
  }
  function submit(write: MemoryPreviewWrite) {
    if (blocked) return;
    const context = { childId, role, sources: fixture.sources, nextId: `${childId}-memory-local-${++sequence.current}`, now: Date.now() };
    let saved: typeof data;
    try { saved = applyMemoryPreviewWrite(data, write, context); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "請重新核對內容。"); return; }
    setError(null);
    controller.submit(() => { setData(saved); setEditor(null); setHistory(null); setConflict(null); }, "basis" in write ? () => simulateConflict(write.basis) : undefined);
  }
  function useLatest() {
    if (!editor || !conflict || controller.operation.state !== "conflict") return;
    if (editor.kind === "fact" && "key" in conflict.latest) setEditor({ ...editor, basis: conflict.latest });
    if (editor.kind === "topic" && "title" in conflict.latest) setEditor({ ...editor, basis: conflict.latest });
    setConflict(null); setError(null); controller.useLatest();
  }
  return { data, sources: fixture.sources, editor, conflict, history, error, controller, blocked,
    beginFact: (mode: FactEditorMode, basis: MemoryFactView | null = null) => begin({ kind: "fact", mode, basis }),
    beginTopic: (mode: TopicEditorMode, basis: MemoryTopicView | null = null) => begin({ kind: "topic", mode, basis }),
    showHistory: (kind: "fact" | "topic", id: string) => { if (!blocked) setHistory({ kind, id }); },
    closeHistory: () => setHistory(null),
    cancel: () => { if (!controller.locked) { controller.reset(); setEditor(null); setConflict(null); setError(null); } },
    submit, useLatest,
  };
}
export type MemoryPreviewController = ReturnType<typeof useMemoryPreview>;
