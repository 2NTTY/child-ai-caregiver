import { useEffect, useRef, useState } from "react";
import type { OperationState } from "../view-model";

export type PreviewWriteOutcome = "success" | "failed" | "unknown" | "conflict";
export type PreviewCheckOutcome = "unknown" | "saved" | "not_applied";
export type PreviewWriteState = OperationState | "conflict";
export interface PreviewWriteOperation { state: PreviewWriteState; message: string; reference: string | null }
const empty: PreviewWriteOperation = { state: "none", message: "", reference: null };

// Preview-only callbacks. No retries, transport, or business authority belong here.
export function usePreviewOperation() {
  const [operation, setOperation] = useState<PreviewWriteOperation>(empty);
  const [outcome, setOutcome] = useState<PreviewWriteOutcome>("success");
  const [checkOutcome, setCheckOutcome] = useState<PreviewCheckOutcome>("unknown");
  const pending = useRef<{ saved: () => void; conflict?: () => void; reference: string } | null>(null);
  const sequence = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); }; }, []);
  const locked = operation.state === "saving" || operation.state === "unknown";
  function later(action: () => void) { timer.current = setTimeout(() => { timer.current = null; if (alive.current) action(); }, 380); }
  function saved() {
    const attempt = pending.current;
    if (!attempt) return;
    pending.current = null;
    attempt.saved();
    setOperation({ state: "saved", message: "模擬已保存；只改變本次預覽，沒有 Server 收據。", reference: attempt.reference });
  }
  return {
    operation, locked, outcome, setOutcome, checkOutcome, setCheckOutcome,
    review() { if (!locked && operation.state !== "conflict") setOperation({ state: "needs_confirmation", message: "請核對下方內容；目前尚未保存。", reference: null }); },
    edit() { if (!locked && operation.state !== "conflict") { pending.current = null; setOperation(empty); } },
    reset() { if (timer.current) clearTimeout(timer.current); pending.current = null; setOperation(empty); },
    submit(onSaved: () => void, onConflict?: () => void) {
      if (locked || pending.current || operation.state !== "needs_confirmation") return;
      const reference = `preview-operation-${++sequence.current}`;
      pending.current = { saved: onSaved, conflict: onConflict, reference };
      setOperation({ state: "saving", message: "正在模擬提交；沒有向 Server 發送請求。", reference });
      later(() => {
        if (outcome === "unknown") setOperation({ state: "unknown", message: "結果未知；須查核同一個原操作，不可建立第二次提交。", reference });
        else if (outcome === "failed") { pending.current = null; setOperation({ state: "failed", message: "模擬失敗：已知沒有保存；草稿保留，請重新核對。", reference }); }
        else if (outcome === "conflict" && onConflict) { pending.current = null; onConflict(); setOperation({ state: "conflict", message: "版本已改變，這次操作沒有保存。比較最新內容後才可換基準。", reference }); }
        else saved();
      });
    },
    check() {
      if (operation.state !== "unknown" || !pending.current) return;
      const reference = pending.current.reference;
      setOperation({ state: "saving", message: "正在模擬查核原操作；沒有重送。", reference });
      later(() => {
        if (checkOutcome === "saved") saved();
        else if (checkOutcome === "not_applied") { pending.current = null; setOperation({ state: "failed", message: "原操作模擬查核為未保存；草稿保留，請重新核對後提交。", reference }); }
        else setOperation({ state: "unknown", message: "原操作仍然結果未知；參考不變，沒有重新提交。", reference });
      });
    },
    useLatest() { if (operation.state === "conflict") setOperation({ ...empty, message: "已明確使用最新基準；草稿保留，請重新核對及確認。" }); },
  };
}
export type PreviewOperationController = ReturnType<typeof usePreviewOperation>;
