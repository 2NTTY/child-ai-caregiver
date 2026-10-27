import { GrowthApiError } from "../../../src/client/growth-api.ts";
import { ConcernApiError } from "../../../src/client/concerns-api.ts";
import type { GrowthPage } from "../../../src/shared/growth.ts";
import type { ConcernPage } from "../../../src/shared/concerns.ts";

type Endpoint = "growth" | "concerns" | "combined";
type Emit = (line: string) => void;
const codes = new Set(["invalid_input", "invalid_json", "unauthorized", "not_found", "session_changed", "account_precondition_required",
  "version_conflict", "source_changed", "source_unavailable", "sharing_confirmation_required", "topic_disabled", "check_original_growth",
  "growth_changed", "growth_fact_requires_review", "growth_history_requires_review", "growth_existing_task_requires_review",
  "concern_changed", "concern_history_requires_review", "operation_mismatch", "check_original_concern",
  "growth_unavailable", "concern_unavailable", "memory_context_requires_selection"]);
const categories = new Set(["http", "schema", "scope", "duplicates", "invalid_json"]);
class AgreementError extends Error {
  constructor(readonly category: "authority_mismatch" | "access_mismatch") { super("Combined growth read failed"); }
}
/** Temporary console diagnostic: fixed primitives only; never serialize the original error. */
export function reportGrowthReadFailure(endpoint: Endpoint, error: unknown, emit: Emit = line => console.warn(line)): void {
  try {
    const apiError = error instanceof GrowthApiError || error instanceof ConcernApiError ? error : null;
    const metadata = apiError?.readFailure;
    const rawStatus = metadata?.status ?? apiError?.status ?? 0;
    const status = Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599 ? rawStatus : 0;
    const rawCode = metadata?.code ?? apiError?.code;
    const code = typeof rawCode === "string" && codes.has(rawCode) ? rawCode : null;
    const agreement = error instanceof AgreementError && (error.category === "authority_mismatch" || error.category === "access_mismatch") ? error.category : null;
    const category = agreement ?? (metadata && categories.has(metadata.category) ? metadata.category : "request");
    const fixedEndpoint = endpoint === "growth" || endpoint === "concerns" ? endpoint : "combined";
    emit("[growth-read] " + JSON.stringify({ endpoint: fixedEndpoint, status, code, category }));
  } catch { /* Diagnostic availability must not change read failure or recovery. */ }
}
export function readGrowthPages(readGrowth: () => Promise<GrowthPage>, readConcerns: () => Promise<ConcernPage>,
  signal: AbortSignal, emit?: Emit, active?: () => boolean): Promise<[GrowthPage, ConcernPage]>;
export function readGrowthPages(readGrowth: (() => Promise<GrowthPage>) | null, readConcerns: (() => Promise<ConcernPage>) | null,
  signal: AbortSignal, emit?: Emit, active?: () => boolean): Promise<[GrowthPage | null, ConcernPage | null]>;
export async function readGrowthPages(readGrowth: (() => Promise<GrowthPage>) | null, readConcerns: (() => Promise<ConcernPage>) | null,
  signal: AbortSignal, emit?: Emit, active: () => boolean = () => !signal.aborted): Promise<[GrowthPage | null, ConcernPage | null]> {
  async function one<T>(endpoint: Endpoint, action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) { if (!signal.aborted && active()) reportGrowthReadFailure(endpoint, error, emit); throw error; }
  }
  const pair = await Promise.all([readGrowth ? one("growth", readGrowth) : null, readConcerns ? one("concerns", readConcerns) : null]);
  const category = pair[0] && pair[1] ? pair[0].authorityVersion !== pair[1].authorityVersion ? "authority_mismatch"
    : pair[0].canManage !== pair[1].canManage ? "access_mismatch" : null : null;
  if (category) {
    const error = new AgreementError(category);
    if (!signal.aborted && active()) reportGrowthReadFailure("combined", error, emit);
    throw error;
  }
  return pair;
}
