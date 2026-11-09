import { RECIPE_KEY, parseHeaderRecipe, serializeHeaderRecipe, type HeaderChoice, type HeaderRecipe } from "./selection.ts";

// Synchronous, caller-supplied metadata port. No ambient storage is selected here.
export interface HeaderRecipeStoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export type HeaderRecipeReceipt = Readonly<{
  status: "unread" | "empty" | "candidate" | "saved" | "unsaved" | "quarantined";
  reason: "none" | "missing-port" | "read-failed" | "write-failed" | "uninspected" | "restore-required" | "invalid-memory" | "invalid" | "unavailable" | "changed";
  // Only a previously validated metadata string or an inspected empty key.
  expected: string | null;
  writable: boolean;
  candidate: HeaderRecipe | null;
}>;
export function unreadHeaderRecipe(): HeaderRecipeReceipt {
  return {status:"unread", reason:"none", expected:null, writable:false, candidate:null};
}
function unsaved(receipt: HeaderRecipeReceipt, reason: HeaderRecipeReceipt["reason"]): HeaderRecipeReceipt {
  return {...receipt, status:"unsaved", reason};
}
function quarantine(reason: "invalid" | "unavailable" | "changed"): HeaderRecipeReceipt {
  // Do not retain/display arbitrary malformed bytes; leave the original key intact.
  return {status:"quarantined", reason, expected:null, writable:false, candidate:null};
}
export function inspectHeaderRecipe(port: HeaderRecipeStoragePort | null): HeaderRecipeReceipt {
  const initial = unreadHeaderRecipe();
  if (!port) return unsaved(initial, "missing-port");
  let raw: string | null;
  try { raw = port.getItem(RECIPE_KEY); } catch { return unsaved(initial, "read-failed"); }
  if (raw === null) return {...initial, status:"empty", writable:true};
  const parsed = parseHeaderRecipe(raw);
  if (parsed.status !== "valid") return quarantine(parsed.status);
  return {status:"candidate", reason:"none", expected:raw, writable:false, candidate:parsed.recipe};
}
export function saveHeaderRecipe(port: HeaderRecipeStoragePort | null, choice: HeaderChoice,
  receipt: HeaderRecipeReceipt, acceptedCandidate?: HeaderRecipe): HeaderRecipeReceipt {
  if (receipt.status === "quarantined") return receipt;
  const serialized = serializeHeaderRecipe(choice);
  if (serialized.status !== "valid") return unsaved(receipt, "invalid-memory");
  const accepted = receipt.candidate !== null && acceptedCandidate === receipt.candidate;
  if (!receipt.writable && !accepted) return unsaved(receipt, receipt.candidate ? "restore-required" : "uninspected");
  // An explicit validated restore authorizes only the exact inspected record.
  const authorized = {...receipt, writable:true};
  if (!port) return unsaved(authorized, "missing-port");
  let current: string | null;
  try { current = port.getItem(RECIPE_KEY); } catch { return unsaved(authorized, "read-failed"); }
  if (current !== receipt.expected) return quarantine("changed");
  try { port.setItem(RECIPE_KEY, serialized.json); } catch { return unsaved(authorized, "write-failed"); }
  return {status:"saved", reason:"none", expected:serialized.json, writable:true, candidate:null};
}
