import type { MemoryFact, MemoryTopic } from "../src/shared/memory.ts";
import { FamilyError } from "./family-access.ts";

export function factIsApplicable(fact: Pick<MemoryFact, "status" | "validUntil" | "sourceState">, now = Date.now()) {
  return fact.status === "confirmed" && fact.sourceState === "current" && (fact.validUntil === null || Date.parse(fact.validUntil) > now);
}
export function topicMayAsk(topic: Pick<MemoryTopic, "status" | "resumeAfter">, now = Date.now()) {
  return topic.status === "pending" || topic.status === "snoozed" && topic.resumeAfter !== null && Date.parse(topic.resumeAfter) <= now;
}
export function requireTopicTransition(current: MemoryTopic["status"], next: MemoryTopic["status"], resumeAfter: string | null) {
  if (current === "resolved" || current === "answered") throw new FamilyError(409, "terminal_topic");
  if ((next === "snoozed") !== (resumeAfter !== null) || resumeAfter !== null && Date.parse(resumeAfter) <= Date.now()) throw new FamilyError(400, "invalid_snooze");
}
export function normalizedFactKey(key: string) {
  return key.normalize("NFKC").trim().toLocaleLowerCase("zh-HK");
}
export function profileIsApplicable(data: { validUntil: string | null } | null, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return data !== null && (data.validUntil === null || data.validUntil >= today);
}

/** Child-referral synonyms the model may rewrite when proposing a memory fact. */
const MEMORY_CHILD_REFERRAL_FORMS = [
  { source: /\bBB\b/giu, content: /\bBB\b/giu },
  { source: /寶寶/gu, content: /寶寶/gu },
  { source: /嬰兒/gu, content: /嬰兒/gu },
  { source: /婴儿/gu, content: /婴儿/gu },
] as const;

/**
 * Keep the user's child nickname from the source message in proposed fact content.
 * Models often rewrite BB→寶寶 (or similar); confirmation and storage must show the user's form.
 * Only rewrites when the source message already uses one of the synonym forms.
 */
export function preserveMemoryFactUserWording(sourceText: string, content: string): string {
  if (!sourceText || !content) return content;
  let preferred: string | null = null;
  let preferredAt = Number.POSITIVE_INFINITY;
  for (const form of MEMORY_CHILD_REFERRAL_FORMS) {
    const re = new RegExp(form.source.source, form.source.flags);
    const match = re.exec(sourceText);
    if (match && match.index < preferredAt) {
      preferredAt = match.index;
      preferred = match[0];
    }
  }
  if (!preferred) return content;
  let next = content;
  for (const form of MEMORY_CHILD_REFERRAL_FORMS) {
    next = next.replace(new RegExp(form.content.source, form.content.flags), preferred);
  }
  return next;
}
