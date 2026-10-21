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

/**
 * True when the current user message is a durable personal-fact statement
 * (allergy, food restriction, or lasting preference such as likes/dislikes)
 * rather than a question/read-back. Used to require propose_fact before present_answer.
 */
export function looksLikeDurableMemoryFactStatement(text: string): boolean {
  const trimmed = text.normalize("NFKC").trim();
  if (!trimmed || trimmed.length > 400) return false;
  // Questions / lookups must not force a new candidate.
  if (/[？?]|(?:有冇|有没有|係咪|是不是|是否|嗎|么)\s*$/u.test(trimmed)) return false;
  if (/(?:有冇|有没有|係咪|是不是|是否).{0,24}(?:過敏|allergy|鍾意|钟意|喜歡|喜欢)/iu.test(trimmed)) return false;
  // A-not-A preference questions (with or without ?).
  if (/鍾唔鍾意|钟唔钟意|喜不喜[歡欢]|愛唔愛|爱唔爱/u.test(trimmed)) return false;
  const allergyOrRestriction = /(?:對.{0,12}過敏|過敏|allergy|忌口|唔可以食|不能吃|不吃)/iu.test(trimmed);
  const preference = /(?:唔鍾意|不喜歡|不喜欢|鍾意|钟意|喜歡|喜欢|愛食|爱吃|愛吃|愛喝|爱喝|偏好|偏愛|偏爱|\blikes?\b|\bloves?\b|\bdislikes?\b|\bprefers?\b)/iu.test(trimmed);
  return allergyOrRestriction || preference;
}
