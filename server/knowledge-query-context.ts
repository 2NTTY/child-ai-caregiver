import type { MemoryContext } from "../src/shared/memory.ts";
import type { AgentHistoryMessage } from "../src/shared/agent-work.ts";
import type { KnowledgeFilter, KnowledgeQueryAge, KnowledgeQueryContext } from "../src/shared/knowledge.ts";
import { FamilyError } from "./family-access.ts";
import { knowledgeQueryAgeSchema } from "./knowledge-inputs.ts";

/** Approximate values are discovery hints; no birth date or eligibility is inferred. */
export function profileKnowledgeAge(context: MemoryContext, now = new Date()): { age: KnowledgeFilter["age"]; precision: KnowledgeQueryContext["precision"]; asOf?: string } {
  const input = context.profileApplicable ? context.profile.data?.age : null;
  if (input?.kind === "birth_date") {
    const birth = new Date(input.date + "T00:00:00Z");
    const months = (now.getUTCFullYear() - birth.getUTCFullYear()) * 12 + now.getUTCMonth() - birth.getUTCMonth();
    const anniversary = (offset: number) => {
      const first = new Date(Date.UTC(birth.getUTCFullYear(), birth.getUTCMonth() + offset, 1));
      const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
      return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(birth.getUTCDate(), last))).getTime();
    };
    const whole = now.getTime() < anniversary(months) ? months - 1 : months;
    const value = whole + (now.getTime() - anniversary(whole)) / (anniversary(whole + 1) - anniversary(whole));
    if (Number.isFinite(value) && value >= 0 && value <= 120) return { age: { basis: "actual", minMonths: value, maxMonths: value }, precision: "confirmed" };
  }
  if (input?.kind === "approximate" && /^\d+(?:\.\d+)?$/.test(input.rawValue.trim())) {
    const scale = { days: 12 / 365.25, weeks: 84 / 365.25, months: 1, years: 12 }[input.unit];
    const asOf = new Date(input.asOf + "T00:00:00Z");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf) || !Number.isFinite(asOf.getTime()) || asOf.toISOString().slice(0, 10) !== input.asOf
      || asOf.getTime() > now.getTime()) return { age: null, precision: "unknown" };
    const elapsedMonths = (now.getTime() - asOf.getTime()) / (86400000 * 365.25 / 12);
    const value = Number(input.rawValue) * scale + elapsedMonths;
    if (Number.isFinite(value) && value >= 0 && value <= 120) return { age: { basis: "actual", minMonths: value, maxMonths: value }, precision: "approximate", asOf: input.asOf };
  }
  return { age: null, precision: "unknown" };
}
export function baseAgentKnowledgeFilter(context: MemoryContext, now = new Date()): KnowledgeFilter {
  const profile = context.profileApplicable ? context.profile.data : null;
  const value = profileKnowledgeAge(context, now), region = profile?.region?.trim() || "HK";
  return { region: /^(香港|Hong Kong)$/iu.test(region) ? "HK" : region, classification: "official_guidance", age: value.age, topics: [],
    ageMatch: value.precision === "confirmed" ? "contained" : value.precision === "approximate" ? "overlap" : "unknown" };
}
export async function resolveKnowledgeQueryContext(context: MemoryContext, raw: KnowledgeQueryAge | undefined,
  options: { childId: string; visibility: "private" | "family"; readHistory: (messageId: string, offset: number) => Promise<AgentHistoryMessage | null> }, now = new Date()) {
  const base = baseAgentKnowledgeFilter(context, now), profileAge = profileKnowledgeAge(context, now);
  let queryContext: KnowledgeQueryContext = { age: base.age, ageMatch: base.ageMatch!, precision: profileAge.precision, ...(profileAge.asOf ? { asOf: profileAge.asOf } : {}) };
  if (!raw) return { filter: base, queryContext };
  const hypothesis = knowledgeQueryAgeSchema.parse(raw);
  if (hypothesis.source === "profile") {
    const profile = context.profileApplicable ? context.profile : null, age = profile?.data?.age;
    const value = age?.kind === "birth_date" ? age.date : age?.kind === "approximate" ? age.rawValue : null;
    if (!profile || profile.version !== hypothesis.profileVersion || value === null || value !== hypothesis.quote)
      throw new FamilyError(409, "knowledge_age_source_mismatch");
  } else {
    if (options.visibility === "family") throw new FamilyError(400, "private_age_source_forbidden");
    const message = await options.readHistory(hypothesis.messageId!, hypothesis.offset ?? 0);
    if (!message || message.id !== hypothesis.messageId || message.childId !== options.childId || message.role !== "user"
      || !message.text.includes(hypothesis.quote)) throw new FamilyError(409, "knowledge_age_source_mismatch");
  }
  if (profileAge.precision === "confirmed" && hypothesis.basis === "actual") {
    queryContext = { ...queryContext, provenance: hypothesis };
    return { filter: base, queryContext };
  }
  const age = { basis: hypothesis.basis, minMonths: hypothesis.minMonths, maxMonths: hypothesis.maxMonths };
  queryContext = { age, ageMatch: "overlap", precision: "query_hypothesis", provenance: hypothesis,
    ...(hypothesis.source === "profile" && profileAge.asOf ? { asOf: profileAge.asOf } : {}) };
  return { filter: { ...base, age, ageMatch: "overlap" as const }, queryContext };
}
