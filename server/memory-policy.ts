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

function hasDurableMemoryFactTopic(trimmed: string): boolean {
  const allergyOrRestriction = /(?:對.{0,12}過敏|過敏|allergy|忌口|唔可以食|不能吃|不吃)/iu.test(trimmed);
  const preference = /(?:唔鍾意|不喜歡|不喜欢|鍾意|钟意|喜歡|喜欢|愛食|爱吃|愛吃|愛喝|爱喝|偏好|偏愛|偏爱|\blikes?\b|\bloves?\b|\bdislikes?\b|\bprefers?\b)/iu.test(trimmed);
  return allergyOrRestriction || preference;
}

/** Compare literal source facts without changing their assertion or polarity. */
export function normalizedMemoryFactText(text: string): string {
  return preserveMemoryFactUserWording("BB", text.normalize("NFKC"))
    .replace(/\s+/gu, "").replace(/[。.!！?？;；,，]+$/u, "").toLocaleLowerCase("zh-HK");
}

function looksLikeMemoryFactQuestionForm(text: string): boolean {
  if (/[？?]|(?:有冇|有没有|係咪|是不是|是否|嗎|吗|么)/u.test(text)) return true;
  return /鍾唔鍾意|钟唔钟意|喜不喜[歡欢]|愛唔愛|爱唔爱/u.test(text);
}

/** Only an imperative at a clause boundary identifies the user's record clause. */
function explicitMemoryRecordStatements(text: string): string[] {
  const clauses = text.normalize("NFKC").match(/[^。！？!?;；，,\n]+[。！？!?;；，,\n]*/gu) ?? [];
  return clauses.flatMap(clause => {
    const match = clause.trim().match(/^(?:(?:請|请)(?:你)?\s*)?(?:(?:幫我|帮我)\s*)?(?:記住|记住|記低|记低|記著|记着|記錄(?:一下)?|记录(?:一下)?|記一記|记一记|記下|记下|[記记](?=\s|[:：]))\s*[:：]?\s*(.+)$/u);
    return match && !looksLikeMemoryFactQuestionForm(match[1]!) ? [match[1]!] : [];
  });
}

/** User-origin temporary wording, not a temporary qualifier invented by the model. */
function looksLikeExplicitShortLivedFact(text: string): boolean {
  return /(?:只係今日|只是今日|只係今晚|只是今晚|只限今日|只限今晚|今晚後不適用|今晚后不适用|今日後不適用|今日后不适用|今晚之後不適用|今晚之后不适用|臨時|暂时|暫時|今次先|今次而已)/u.test(text)
    || /(?:今晚|今夜)/u.test(text);
}

export function looksLikeDurableMemoryFactStatement(text: string): boolean {
  const trimmed = text.normalize("NFKC").trim();
  if (!trimmed) return false;
  if (looksLikeMemoryFactQuestionForm(trimmed)) {
    return explicitMemoryRecordStatements(trimmed).some(hasDurableMemoryFactTopic);
  }
  return hasDurableMemoryFactTopic(trimmed);
}

export function looksLikeDurableMemoryFactQuestion(text: string): boolean {
  const trimmed = text.normalize("NFKC").trim();
  return looksLikeMemoryFactQuestionForm(trimmed) && explicitMemoryRecordStatements(trimmed).length === 0;
}

/** A mixed record/query may propose only its literal declarative record clause. */
export function requireMemoryFactSource(sourceText: string, content: string): void {
  if (looksLikeDurableMemoryFactQuestion(sourceText)) throw new FamilyError(400, "memory_read_not_propose");
  if (!looksLikeMemoryFactQuestionForm(sourceText)) return;
  const candidate = normalizedMemoryFactText(content);
  if (!candidate || !explicitMemoryRecordStatements(sourceText).some(clause => normalizedMemoryFactText(clause) === candidate)) {
    throw new FamilyError(400, "memory_fact_source_mismatch");
  }
}

/** A temporary qualifier belongs to its own fact clause, never a neighboring fact. */
function matchingTemporaryFactSource(content: string, sourceText: string): boolean {
  const clauses = (text: string) => text.normalize("NFKC").split(/[。！？!?;；，,\n]+/u).filter(part => part.trim());
  const factBody = (text: string) => normalizedMemoryFactText((explicitMemoryRecordStatements(text)[0] ?? text)
    .replace(/(?:只係|只是|只限)?(?:今日|今天|今晚|今夜)|(?:臨時|临时|暫時|暂时)|今次先|今次而已/gu, ""));
  const candidateFacts = clauses(content).filter(hasDurableMemoryFactTopic);
  const sourceFacts = clauses(sourceText);
  const trailingWindow = /^(?:(?:只係|只是|只限)(?:今日|今天|今晚|今夜)|(?:今日|今天|今晚|今夜)(?:之後|之后|後|后)不[適适]用|(?:明早|明天|明日)(?:恢復|恢复)|今次先|今次而已)$/u;
  return candidateFacts.length > 0 && candidateFacts.every(candidate => sourceFacts.some((source, index) =>
    factBody(source) === factBody(candidate) && (looksLikeExplicitShortLivedFact(source)
      // A qualifier-only next clause modifies this fact, never an earlier fact across another assertion.
      || trailingWindow.test(sourceFacts[index + 1]?.trim() ?? ""))));
}

/** Near-term model expiries (~minutes/hours) are not valid for durable allergy/preference facts unless the user stated an explicit short-lived window. */
const DURABLE_FACT_MIN_VALID_MS = 24 * 60 * 60 * 1000;

/**
 * Coerce absurdly short validUntil values on allergy/preference proposals to null
 * (no expiry), unless the trusted source marks an explicit short-lived window.
 * Longer intentional windows are kept.
 */
export function sanitizeDurableMemoryFactValidUntil(content: string, validUntil: string | null, now = Date.now(), sourceText = content): string | null {
  if (validUntil === null) return null;
  const normalized = content.normalize("NFKC").trim();
  if (!hasDurableMemoryFactTopic(normalized) && !hasDurableMemoryFactTopic(sourceText)) return validUntil;
  // Explicit short-lived wording (e.g. 只係今日／今晚後不適用) keeps the stated window.
  if (matchingTemporaryFactSource(content, sourceText)) return validUntil;
  const until = Date.parse(validUntil);
  if (!Number.isFinite(until) || until - now < DURABLE_FACT_MIN_VALID_MS) return null;
  return validUntil;
}
