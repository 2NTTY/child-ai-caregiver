import { useEffect, useRef, useState } from "react";
import type { OperationState } from "../view-model";
import { usePreviewLeaveGuard } from "./PreviewNavigationGuard";

export type PreviewWriteOutcome = "success" | "failed" | "unknown" | "conflict";
export type PreviewCheckOutcome = "unknown" | "saved" | "not_applied" | "confirmed_unavailable" | "reload_failed";
export type PreviewWriteState = OperationState | "conflict";
export interface PreviewWriteOperation { state: PreviewWriteState; message: string; reference: string | null; recovery?: "check" | "retry" | "reload"; resultUnavailable?: boolean }
const empty: PreviewWriteOperation = { state: "none", message: "", reference: null };

// Preview-only frozen callbacks. Production recovery is owned by the existing transport/controller.
export function usePreviewOperation() {
  const [operation, setOperation] = useState<PreviewWriteOperation>(empty);
  const [outcome, setOutcome] = useState<PreviewWriteOutcome>("success");
  const [checkOutcome, setCheckOutcome] = useState<PreviewCheckOutcome>("unknown");
  const [readOutcome, setReadOutcome] = useState<"success" | "failed" | "unavailable">("success");
  const pending = useRef<{ saved: () => void; conflict?: () => void; reference: string } | null>(null);
  const sequence = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); }; }, []);
  const locked = operation.state === "saving" || operation.state === "unknown";
  usePreviewLeaveGuard(operation.state === "needs_confirmation" || operation.state === "conflict", locked);
  function later(action: () => void) { timer.current = setTimeout(() => { timer.current = null; if (alive.current) action(); }, 380); }
  function saved() {
    const attempt = pending.current;
    if (!attempt) return;
    pending.current = null;
    attempt.saved();
    setOperation({ state: "saved", message: "模擬已保存；只改變本次預覽，沒有 Server 收據。", reference: attempt.reference });
  }
  function runOriginal() {
    const attempt = pending.current;
    if (!attempt) return;
    const reference = attempt.reference;
    setOperation({ state: "saving", message: "正在模擬提交原內容及原參考；沒有另建一次操作。", reference });
    later(() => {
      if (outcome === "unknown") setOperation({ state: "unknown", recovery: "check", message: "結果未知；須查核同一個原操作，不可建立第二次提交。", reference });
      else if (outcome === "failed") { pending.current = null; setOperation({ state: "failed", message: "模擬失敗：已知沒有保存；草稿保留，請重新核對。", reference }); }
      else if (outcome === "conflict" && attempt.conflict) { pending.current = null; attempt.conflict(); setOperation({ state: "conflict", message: "版本已改變，這次操作沒有保存。比較最新內容後才可換基準。", reference }); }
      else saved();
    });
  }
  return {
    operation, locked, outcome, setOutcome, checkOutcome, setCheckOutcome, readOutcome, setReadOutcome,
    review() { if (!locked && operation.state !== "conflict") setOperation({ state: "needs_confirmation", message: "請核對下方內容；目前尚未保存。", reference: null }); },
    edit() { if (!locked && operation.state !== "conflict") { pending.current = null; setOperation(empty); } },
    reset() { if (timer.current) clearTimeout(timer.current); pending.current = null; setOperation(empty); },
    submit(onSaved: () => void, onConflict?: () => void) {
      if (locked || pending.current || operation.state !== "needs_confirmation") return;
      const reference = `preview-operation-${++sequence.current}`;
      pending.current = { saved: onSaved, conflict: onConflict, reference };
      runOriginal();
    },
    check() {
      if (operation.state !== "unknown" || !pending.current) return;
      const reference = pending.current.reference;
      setOperation({ state: "saving", message: "正在模擬查核原操作；沒有重送。", reference });
      later(() => {
        if (checkOutcome === "saved") saved();
        else if (checkOutcome === "not_applied") setOperation({ state: "unknown", recovery: "retry", message: "原操作尚無確認收據；這不代表已知失敗。原內容、版本及參考保持鎖定，只可明確重試同一操作。", reference });
        else if (checkOutcome === "confirmed_unavailable" || checkOutcome === "reload_failed") setOperation({ state: "unknown", recovery: "reload", message: "原操作已確認；結果尚未讀回或已不可讀。只能重新讀取，不能再提交。", reference });
        else setOperation({ state: "unknown", recovery: "check", message: "原操作仍然結果未知；參考不變，沒有重新提交。", reference });
      });
    },
    retryOriginal() { if (operation.recovery === "retry" && pending.current) runOriginal(); },
    reloadCurrent() {
      if (operation.recovery !== "reload" || !pending.current) return;
      const reference = pending.current.reference;
      setOperation({ ...operation, state: "saving", message: "正在模擬重讀目前資料；沒有重新提交。" });
      later(() => {
        if (readOutcome === "success") saved();
        else if (readOutcome === "unavailable") { pending.current = null; setOperation({ state: "saved", reference, resultUnavailable: true, message: "原操作已確認，但結果已刪除或不可讀。待查已結束；沒有猜測結果或重新提交。" }); }
        else setOperation({ state: "unknown", reference, recovery: "reload", message: "原操作已確認，但重讀失敗。保留原參考，請手動重讀；不能再提交。" });
      });
    },
    useLatest() { if (operation.state === "conflict") setOperation({ ...empty, message: "已明確使用最新基準；草稿保留，請重新核對及確認。" }); },
  };
}
export type PreviewOperationController = ReturnType<typeof usePreviewOperation>;
