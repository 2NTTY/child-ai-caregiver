import { useEffect, useRef, useState } from "react";
import type { ChatMessageView, ChatReplyPhase } from "../chat-view-model";
import { previewAnswerCitations } from "./answer-citations";

export interface PreviewChatMessage extends ChatMessageView { kind: "plain" | "intro" | "local" | "stream" }
const finalText = "這是本地合成的串流示例。你看到的文字會更新在同一則訊息內；執行過程可以展開或收起。往上閱讀時不會自動拉回底部，完成後沿用最終回覆及其來源快照。這裏沒有呼叫 Agent、工具或保存資料。示例參考來源【1】。";

function initialMessages(childId: string): PreviewChatMessage[] {
  const topics = ["已有照顧記錄", "想了解的問題", "資料的原日期", "記錄的原文", "確認與候選", "討論的範圍"];
  return [...topics.flatMap((topic, index): PreviewChatMessage[] => [
    { id: `${childId}-history-${index}-user`, role: "user", text: `歷史版式示例：查看${topic}。`, note: "本地合成記錄 · 並非真實對話", kind: "plain" },
    { id: `${childId}-history-${index}-answer`, role: "assistant", text: `這則只示範「${topic}」的歷史記錄版式，沒有生成建議或執行操作。`, kind: "plain" },
  ]),
  { id: `${childId}-question`, role: "user", text: "最近一星期孩子晚上比較難入睡。我應該先整理哪些資料，才方便討論睡前流程？", note: "合成問題示例 · 未向 Server 發送", kind: "plain" },
  { id: `${childId}-answer`, role: "assistant", text: "", sources: previewAnswerCitations, kind: "intro" }];
}

// Synthetic display scenarios only. Timers never represent a real model or tool transport.
export function useChatTimelinePreview(childId: string) {
  const [messages, setMessages] = useState<PreviewChatMessage[]>(() => initialMessages(childId));
  const [followRequest, setFollowRequest] = useState<string>();
  const nextId = useRef(0), activeId = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function clearTimer() { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; }
  useEffect(() => () => { clearTimer(); activeId.current = null; }, []);
  function update(id: string, patch: Partial<PreviewChatMessage>) {
    setMessages(previous => previous.map(message => message.id === id ? { ...message, ...patch } : message));
  }
  function stop(id: string) {
    if (activeId.current === id) { clearTimer(); activeId.current = null; }
    update(id, { phase: "stopped", note: "本地合成示例 · 已停止，部分文字不代表完整回覆" });
  }
  function addQuestion(text: string) {
    const id = `${childId}-local-${++nextId.current}`;
    setMessages(previous => [...previous, { id, role: "user", text, note: "本地預覽 · 未送出", kind: "local" }]); setFollowRequest(id);
  }
  function showReply(phase: ChatReplyPhase) {
    if (activeId.current) stop(activeId.current);
    const id = `${childId}-stream-${++nextId.current}`;
    const streaming = phase === "streaming", active = streaming || phase === "thinking";
    const tools: NonNullable<ChatMessageView["activities"]> = [{ id: `${id}-data`, label: "示例資料核對", state: active ? "running" : phase === "unknown" ? "unknown" : phase === "failed" ? "failed" : "pending", summary: "這是公開步驟版式示例，沒有工具呼叫或內部推理內容。" }];
    setMessages(previous => [...previous,
      { id: `${id}-question`, role: "user", text: "示範回覆狀態及執行過程。", note: "本地合成示例", kind: "plain" },
      { id, role: "assistant", text: active ? "" : "這是尚未完成的合成回覆片段。", phase: streaming ? "thinking" : phase, activities: tools, note: "本地合成示例 · 未接通 Agent 或工具", kind: "stream" }]);
    setFollowRequest(id);
    if (!active) return;
    activeId.current = id;
    if (!streaming) return;
    timer.current = setTimeout(() => {
      if (activeId.current !== id) return;
      update(id, { activities: [{ ...tools[0], state: "succeeded" }, { id: `${id}-sources`, label: "示例來源整理", state: "running", summary: "只整理本地合成來源版式。" }] });
      timer.current = setTimeout(() => {
        if (activeId.current !== id) return;
        update(id, { phase: "streaming" });
        const characters = Array.from(finalText.slice(0, finalText.indexOf("示例參考來源")));
        let count = 0;
        function tick() {
          if (activeId.current !== id) return;
          count += 3;
          if (count < characters.length) {
            update(id, { text: characters.slice(0, count).join("") }); timer.current = setTimeout(tick, 60);
          } else {
            // Replace deltas with the authoritative final display snapshot; do not freeze the concatenated text.
            update(id, { text: finalText, phase: "complete", sources: [previewAnswerCitations[0]], activities: [{ ...tools[0], state: "succeeded" }, { id: `${id}-sources`, label: "示例來源整理", state: "succeeded", summary: "已顯示合成來源快照，並非真實來源證據。" }] });
            activeId.current = null; timer.current = null;
          }
        }
        tick();
      }, 700);
    }, 900);
  }
  return { messages, followRequest, addQuestion, showReply, stop };
}
