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
