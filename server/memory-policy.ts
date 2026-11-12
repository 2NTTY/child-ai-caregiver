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

/** Only an imperative at a sentence boundary identifies the user's record clauses. */
function explicitMemoryRecordStatements(text: string): string[] {
  const sentences = text.normalize("NFKC").match(/[^。！？!?;；\n]+[。！？!?;；\n]*/gu) ?? [];
  const lead = /^(?:想\s*)?(?:(?:請|请|麻煩|唔該)(?:你)?\s*)?(?:(?:幫我|帮我)\s*)?(?:記住|记住|記低|记低|記著|记着|記錄(?:一下)?|记录(?:一下)?|記一記|记一记|記下|记下|[記记](?=\s|[:：,，]))\s*[:：,，]?\s*(.+)$/u;
  return sentences.flatMap(sentence => {
    const match = sentence.trim().match(lead);
    if (!match) return [];
    const body = match[1]!;
    if (!looksLikeMemoryFactQuestionForm(body)) return [body];
    // Stop before a trailing question clause inside the same sentence (e.g. "記住，BB 對雞蛋過敏，明天帶甚麼？").
    const parts = body.match(/[^，,]+[，,]*/gu) ?? [];
    const prefix: string[] = [];
    for (const part of parts) {
      if (looksLikeMemoryFactQuestionForm(part)) break;
      prefix.push(part);
    }
    if (!prefix.length) return [];
    const joined = prefix.join("").replace(/[，,]+$/u, "");
    return prefix.length > 1 ? [...prefix, joined] : [prefix[0]!];
  });
}

const ADULT_ROLE_PREFIX = /^(?:媽媽|媽咪|爸爸|爹地|父親|母親|家長|祖父|祖母|公公|婆婆|外公|外婆|外傭|姐姐|工人|陪月|老師|醫生|護士|別人|其他人|他人|我|自己|本人)$/u;
const OTHER_SUBJECT_PATTERN = /(?:媽媽|媽咪|爸爸|爹地|父親|母親|家長|祖父|祖母|公公|婆婆|外公|外婆|外傭|姐姐|工人|陪月|老師|醫生|護士|別人|其他人|他人|我自己|我本人)/u;
const CHILD_SUBJECT_PATTERN = /\bBB\b|寶寶|嬰兒|婴儿/iu;
const FACT_NEGATION_PATTERN = /(?:並不|並無|不是|非|不會|不再|未有|沒有|無|冇|唔(?:會|好|係|喜歡|鍾意|愛吃|爱吃)?|不要|別|勿|\bnot\b|\bnever\b|\bno\s+(?:allergy|allergies|longer)\b)/iu;

function canonicalMemoryPredicate(text: string): string {
  return text
    .normalize("NFKC")
    .trim()
    .replace(/^(?:已確認記憶|根據(?:.*?(?:記錄|資料|記憶))?|目前記錄|據我所知|此外|另外|至於|而且|而(?=(?:平時|每日|每天|通常|一般|目前)))[:：,，\s]*/u, "")
    .replace(/\bBB\b|寶寶|嬰兒|婴儿/giu, "bb")
    .replace(/同埋|以及|跟|與|和|及|同(?!(?:時|樣|類|等|居|住|學|意))/gu, "、")
    .replace(/鍾意|鐘意|喜愛/gu, "喜歡")
    .replace(/下晝/gu, "下午")
    .replace(/瞓晏晝覺|訓晏晝覺/gu, "睡午覺")
    .replace(/(平時|每日|每晚|早上|上午|下午)[會喺在]+(?=\d|上午|下午|早|晚|午)/gu, "$1")
    .replace(/(?:會?[喺在])(?=\d|上午|下午)/gu, "")
    .replace(/會(?=睡午覺)/gu, "")
    .replace(/半(?:個)?(?:鐘頭?|小時)/gu, "30分鐘")
    .replace(/有((?:嚴重)?過敏)/gu, "$1")
    .replace(/\s+/gu, "")
    .replace(/[。.!！?？;；,，]+$/u, "")
    .toLocaleLowerCase("zh-HK");
}

const NON_NAME_LEAD = /^(?:平時|通常|一般|有時|目前|現時|現在|而家|另外|此外|還有|而且|不過|但是|然而|所以|因此|如|若|每|早上|上午|下午|下晝|晚上|今晚|今朝|尋晚|之後|之前)/u;

function stripLeadingChildSubject(canonical: string): string | null {
  if (canonical.startsWith("bb")) return canonical.slice(2);
  if (NON_NAME_LEAD.test(canonical)) return null;
  // Allow an unnamed single child's proper name (e.g. 小明對花生過敏) when not an adult caregiver role or adverb.
  const match = canonical.match(/^([^\s對喜歡不唔冇]+?)(對.+|喜歡.+|不喜歡.+|唔.+|平時.+|下午.+|每天.+|每日.+)$/u);
  if (match && !ADULT_ROLE_PREFIX.test(match[1]!) && !NON_NAME_LEAD.test(match[1]!)) return match[2]!;
  return null;
}

function memoryFactClauseReferencedByParagraph(factClause: string, clauses: string[]): boolean {
  const literal = normalizedMemoryFactText(factClause);
  if (!literal) return false;
  const factHasNegation = FACT_NEGATION_PATTERN.test(factClause);
  const canonicalFact = canonicalMemoryPredicate(factClause);
  if (!canonicalFact) return false;
  const factPredicate = stripLeadingChildSubject(canonicalFact) ?? canonicalFact;
  const allergyItems = factPredicate.match(/^對(.+?)(?:嚴重)?過敏$/u)?.[1]?.split("、").filter(Boolean) ?? [];

  let childSubjectActive = false;
  let otherSubjectActive = false;
  for (const clause of clauses) {
    const canonicalClause = canonicalMemoryPredicate(clause);
    if (!canonicalClause) continue;
    const clausePredicate = stripLeadingChildSubject(canonicalClause);
    if (OTHER_SUBJECT_PATTERN.test(clause)) {
      otherSubjectActive = true;
      childSubjectActive = false;
    } else if (CHILD_SUBJECT_PATTERN.test(clause) || clausePredicate !== null) {
      childSubjectActive = true;
      otherSubjectActive = false;
    }
    if (FACT_NEGATION_PATTERN.test(clause) !== factHasNegation) continue;
    if (canonicalClause.includes(canonicalFact)) return true;
    if ((canonicalFact.startsWith("bb") || factPredicate !== canonicalFact) && clausePredicate && clausePredicate.includes(factPredicate)) return true;
    // Allow subject-omitted continuation clauses (e.g. "BB 對花生過敏，平時下晝 2 點會瞓晏晝覺") when no adult subject overrides it.
    if (factPredicate.length >= 3 && !otherSubjectActive && (childSubjectActive || canonicalClause === factPredicate)
      && canonicalClause.includes(factPredicate)) return true;
    if (!factHasNegation && allergyItems.length > 0 && /對.+過敏$/u.test(canonicalClause)) {
      const clauseAllergens = canonicalClause.match(/對(.+?)(?:嚴重)?過敏/u)?.[1] ?? "";
      if (clausePredicate !== null && allergyItems.some(item => clauseAllergens.includes(item))) return true;
      if (canonicalClause.startsWith("對") && !otherSubjectActive && allergyItems.some(item => clauseAllergens.includes(item))) return true;
    }
  }
  return false;
}

/**
 * Check whether an answer paragraph genuinely restates a confirmed memory fact.
 * Applies the same clause checks to literal and child-name / HK wording paraphrases,
 * and rejects opposite-polarity clauses so unsupported denials cannot pass as grounded.
 */
export function memoryFactReferencedByParagraph(factContent: string, paragraphText: string): boolean {
  const literal = normalizedMemoryFactText(factContent);
  const literalParagraph = normalizedMemoryFactText(paragraphText);
  if (!literal || !literalParagraph) return false;

  const clauses = paragraphText.normalize("NFKC").split(/[。！？!?;；，,\n]+/u).map(part => part.trim()).filter(Boolean);
  if (memoryFactClauseReferencedByParagraph(factContent, clauses)) return true;

  const subFacts = factContent.normalize("NFKC").split(/[。！？!?;；，,\n]+/u).map(part => part.trim()).filter(Boolean);
  if (subFacts.length > 1) {
    return subFacts.some(sub => sub.length >= 4 && memoryFactClauseReferencedByParagraph(sub, clauses));
  }
  return false;
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
