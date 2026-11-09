/** One task-row presentation receipt; no domain data, DOM nodes or navigation owner. */
export type TaskReturnReceipt = { token: number; scope: string; id: string; list: string; position: number };
type Pending = TaskReturnReceipt & { phase: "origin" | "accepted" | "displayed" | "closing" | "returning" };
export function createTaskFocusReturn() {
  let serial = 0, receipt: Pending | null = null;
  const matches = (token: number | null, scope: string | null, id: string | null) =>
    receipt !== null && token !== null && receipt.token === token && receipt.scope === scope && receipt.id === id;
  return {
    remember(scope: string, id: string | null, list: string, position: number): number | null {
      receipt = null;
      if (!id || !Number.isFinite(position) || position < 0 || !Number.isSafeInteger(serial + 1)) return null;
      receipt = { token: ++serial, scope, id, list, position, phase: "origin" };
      return receipt.token;
    },
    originToken(scope: string | null, id: string | null): number | null {
      return receipt?.phase === "origin" && receipt.scope === scope && receipt.id === id ? receipt.token : null;
    },
    acceptOpen(token: number | null, scope: string | null, id: string | null): boolean {
      if (!matches(token, scope, id) || receipt!.phase !== "origin") return false;
      receipt!.phase = "accepted"; return true;
    },
    displayed(scope: string, id: string, list: string) {
      if (!receipt) return;
      if (receipt.scope !== scope || receipt.id !== id || receipt.list !== list) { receipt = null; return; }
      if (receipt.phase === "accepted") receipt.phase = "displayed";
    },
    detailToken(scope: string | null, id: string | null): number | null {
      return receipt?.phase === "displayed" && receipt.scope === scope && receipt.id === id ? receipt.token : null;
    },
    beginClose(token: number | null, scope: string | null, id: string | null): boolean {
      if (!matches(token, scope, id) || receipt!.phase !== "displayed") return false;
      receipt!.phase = "closing"; return true;
    },
    settled(token: number | null, scope: string | null, id: string | null): boolean {
      if (!matches(token, scope, id) || receipt!.phase !== "closing") return false;
      receipt!.phase = "returning"; return true;
    },
    take(scope: string, list: string): TaskReturnReceipt | null {
      if (receipt?.phase !== "returning") return null;
      const saved = receipt; receipt = null;
      if (saved.scope !== scope || saved.list !== list) return null;
      const { phase: _phase, ...metadata } = saved; return metadata;
    },
    cancel(token: number | null) { if (token !== null && receipt?.token === token) receipt = null; },
    clear() { receipt = null; },
    invalidateScope(scope: string) { if (receipt && receipt.scope !== scope) receipt = null; },
  };
}
export function taskListSignature(route: { tab: string; filter: string; page: number; day: string | null; month: string | null }, query: string) {
  return JSON.stringify([route.tab, route.filter, route.page, route.day, route.month, query]);
}
/** Use only current component refs; a deliberate live focus move always wins. */
export function restoreTaskReturnFocus(candidates: readonly (HTMLElement | null | undefined)[], ownerDocument: Pick<Document, "activeElement" | "body">): boolean {
  const active = ownerDocument.activeElement;
  if (active && active !== ownerDocument.body) return candidates.includes(active as HTMLElement);
  for (const target of candidates) {
    if (!target?.isConnected || !target.getClientRects().length || target.hasAttribute("disabled")
      || target.getAttribute("aria-disabled") === "true" || target.closest('[inert],[aria-hidden="true"]')) continue;
    target.focus({ preventScroll: true });
    if (ownerDocument.activeElement === target) return true;
  }
  return false;
}
