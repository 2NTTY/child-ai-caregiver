import type { MemoryContext } from "../src/shared/memory.ts";
import type { KnowledgeEvidence } from "../src/shared/knowledge.ts";
import type { GrowthAttention, GrowthBasis, GrowthInput, GrowthTopicId } from "../src/shared/growth.ts";
import { agentKnowledgeFilter } from "./product-agent-tools.ts";
export const GROWTH_CATALOG_REVISION = "hk-growth-20260928-v1";
interface Rule { id: GrowthTopicId; title: string; stage: string; start: number; end: number; sourceId: string; key: string; hash: string; revision: string; inputs: Omit<GrowthInput, "value" | "conflict" | "factRefs">[] }
const input = (key: string, label: string, pairs: [string, string][]) => ({ key, label, choices: pairs.map(([value, label]) => ({ value, label })) });
/** Reviewed public knowledge; product windows are not clinical deadlines. */
export const GROWTH_RULES: readonly Rule[] = [
  { id: "solid_food", revision: "solid_food-v1", title: "引入固體食物", stage: "infant-solids", start: 6, end: 12,
    sourceId: "fhs-solid-food", key: "starting-solids", hash: "08cd6022928f532f75111c6e3ad702fdd98746666c2d30c51fe941a748c47396",
    inputs: [input("growth.solid_food", "固體食物近況", [["not_started", "已確認尚未開始"], ["started", "已開始"], ["professional_plan", "正按醫護的個別計劃"]])] },
  { id: "toddler_play", revision: "toddler_play-v1", title: "幼兒遊戲與溝通", stage: "toddler-12-24", start: 12, end: 24,
    sourceId: "fhs-toddler-development", key: "play-and-language", hash: "5f1aa83373ab693807c9bc93194e9003a6b8ccb588a15d0c62bb46e63de9490d",
    inputs: [input("growth.play", "遊戲與溝通安排", [["would_like_ideas", "想了解陪玩方法"], ["covered", "已有合適安排"]])] },
  { id: "preschool_development", revision: "preschool_development-v1", title: "學前發展觀察", stage: "preschool-36-72", start: 36, end: 72,
    sourceId: "fhs-preschool-development", key: "persistent-concerns", hash: "21ff3b6b994708c58454f84d5c565adce7c69d04cf20624c57a8fd3cd692b34e",
    inputs: [input("growth.development_concern", "家長與老師的觀察", [["persistent_multiple", "已觀察到多項問題而且持續"], ["none", "目前沒有相關疑慮"], ["under_follow_up", "已在跟進"]])] },
  { id: "school_vision", revision: "school_vision-v1", title: "學童視力關注", stage: "school-72-120", start: 72, end: 120,
    sourceId: "fhs-child-vision", key: "school-eye-care", hash: "7ebf7f07893ba43c6dfe53599e3d86434702a4723d76c6b6ff65ba6954d801ff",
    inputs: [input("growth.school_year", "目前年級", [["primary_one", "小學一年級"], ["other", "其他年級"]]),
      input("growth.vision", "視力近況", [["concern", "對視力有疑慮"], ["no_concern", "目前沒有視力疑慮"], ["follow_up", "已按專業人員跟進"], ["screening_completed", "已完成相關檢查"]])] },
];
export function growthInputs(rule: Rule, context: MemoryContext): GrowthInput[] {
  return rule.inputs.map(definition => {
    const key = definition.key, matching = context.facts.filter(fact => fact.visibility === "family" && fact.status === "confirmed" && fact.applicable && fact.key.trim().toLowerCase() === key);
    const values = new Set(matching.map(fact => fact.content));
    const conflict = context.conflictingKeys.includes(key) || values.size > 1;
    const value = !conflict && !context.unavailableFactKeys.includes(key) && values.size === 1 ? [...values][0] : null;
    return { ...definition, value: value && definition.choices.some(choice => choice.value === value) ? value : null, conflict, factRefs: matching.map(({id,version})=>({id,version})) };
  });
}
export function growthBasisChanged(previous: GrowthBasis, next: GrowthBasis): boolean {
  return previous.stage !== next.stage || previous.ruleRevision !== next.ruleRevision || previous.sourceHash !== next.sourceHash
    || Object.entries(next.values).some(([key, value]) => value !== "unknown" && previous.values[key] !== value);
}
export function nextGrowthCheck(context: MemoryContext, now: Date): string | null {
  const dates: number[] = [];
  const profile = context.profileApplicable ? context.profile.data : null;
  if (profile?.age.kind === "birth_date") {
    const birth = new Date(profile.age.date + "T00:00:00Z");
    for (const months of new Set(GROWTH_RULES.flatMap(rule => [rule.start, rule.end]))) {
      const month = new Date(Date.UTC(birth.getUTCFullYear(), birth.getUTCMonth() + months, 1));
      const last = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
      dates.push(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), Math.min(last, birth.getUTCDate())));
    }
  }
  if (profile?.validUntil) dates.push(Date.parse(profile.validUntil)+86400000);
  for (const fact of context.facts) if (GROWTH_RULES.some(rule => rule.inputs.some(input => input.key === fact.key.trim().toLowerCase())) && fact.validUntil) dates.push(Date.parse(fact.validUntil));
  const next = dates.filter(time => Number.isFinite(time) && time > now.getTime()).sort((a,b) => a-b)[0];
  return next ? new Date(next).toISOString() : null;
}
export function growthProposals(context: MemoryContext, sources: KnowledgeEvidence[], now: Date) {
  const filter = agentKnowledgeFilter(context, now), months = filter.age?.minMonths;
  const proposals: Omit<GrowthAttention, "id" | "childId" | "version" | "state" | "createdAt" | "updatedAt" | "snoozeUntil" | "previousId" | "newReason" | "taskId" | "taskState" | "lastAction" | "actorUserId" | "note">[] = [];
  const notices: string[] = [];
  if (months === undefined) return { proposals, notices: ["需要有效的出生日期才可套用本批年齡規則；約數年齡會保留，沒有推算精準提醒窗口。"] };
  if (filter.region !== "HK") return { proposals, notices: ["首批關注只適用香港；沒有把香港時程套用至其他地區。"] };
  for (const rule of GROWTH_RULES) {
    if (months < rule.start || months >= rule.end) continue;
    const source = sources.find(item => item.sourceId === rule.sourceId && item.key === rule.key && item.contentHash === rule.hash && item.url === "https://www.fhs.gov.hk/tc_chi/health_info/child/" + ({solid_food:"30039.html",toddler_play:"15654.html",preschool_development:"14821.html",school_vision:"14812.html"}[rule.id]));
    if (!source) { notices.push(rule.title + "的已核對來源暫未可用，沒有以失效或未核對的內容產生建議。"); continue; }
    const inputs = growthInputs(rule, context), values = Object.fromEntries(inputs.map(item => [item.key, item.value ?? "unknown"]));
    let kind: GrowthAttention["kind"] = "observe", advice = "", missing = "";
    if (rule.id === "solid_food") {
      if (["started", "professional_plan"].includes(values["growth.solid_food"])) continue;
      kind = "arrange"; missing = values["growth.solid_food"] === "unknown" ? "尚未確認是否已開始，請先補充近況；沒有判定家長漏做。 " : "已確認尚未開始。 ";
      advice = "家庭健康服務指出寶寶踏入六個月時應已開始固體食物。可參考官方起步資料；如未開始或有個別飲食需要，請向醫護人員查詢。";
    } else if (rule.id === "toddler_play") {
      if (values["growth.play"] === "covered") continue;
      advice = "可在安全環境一起談天、看圖畫書、唱童謠及玩積木，按孩子的節奏觀察和陪伴；如對發展有疑問，可向母嬰健康院或醫護人員查詢。";
    } else if (rule.id === "preschool_development") {
      if (["none", "under_follow_up"].includes(values["growth.development_concern"])) continue;
      const confirmed = values["growth.development_concern"] === "persistent_multiple";
      kind = confirmed ? "consult" : "observe";
      missing = confirmed ? "家長已確認觀察到多項持續問題。 " : "尚未有足夠已確認觀察，請先補充家長與老師所見；沒有推斷孩子存在發展問題。 ";
      advice = "孩子在不同環境的表現可不同，可與老師交流。若出現官方資料列出的多項問題而且持續，應盡快請老師安排轉介，或聯絡母嬰健康院約見護士。";
    } else {
      const vision = values["growth.vision"], grade = values["growth.school_year"];
      if (["follow_up", "screening_completed"].includes(vision) || (grade === "other" && vision === "no_concern")) continue;
      if (vision === "concern") { kind = "consult"; advice = "家長已確認對視力有疑慮，可盡早安排醫生或社區視光師檢查；先前通過普查不保證日後沒有視力問題。"; }
      else if (grade === "primary_one") { kind = "arrange"; advice = "已確認孩子就讀小一；可了解衞生署學生健康服務的視力檢查。請先核對是否已有安排，沒有記錄不代表未做。"; }
      else { missing = "尚未確認年級或視力近況，請先補充；年齡不代表已讀小一。 "; advice = "官方資料提到小一的視力檢查安排；如對視力有疑慮，應向醫生或社區視光師查詢。"; }
    }
    proposals.push({ topicId: rule.id, title: rule.title, kind, whyNow: missing + "已確認的實際年齡進入本產品關注階段。",
      advice, limits: "本產品提示範圍為 " + rule.start + " 至未滿 " + rule.end + " 個月，並非官方完成期限。按實際年齡，沒有套用矯正年齡；只作有限照護關注，不診斷或判定任務已完成。",
      basis: { stage: rule.stage, ruleRevision: rule.revision, sourceHash: rule.hash, values },
      evidence: { profileVersion: context.profile.version, facts: context.facts.filter(fact => rule.inputs.some(input => input.key === fact.key.trim().toLowerCase()) && fact.visibility === "family").map(({ id, version }) => ({ id, version })) },
      source: { sourceId: source.sourceId, versionId: source.versionId, chunkId: source.chunkId, contentHash: source.contentHash,
        url: source.url, title: source.title, section: source.section, checkedAt: source.checkedAt, excerpt: "核對片段摘要：" + source.text + "\n官方短引：" + source.sourceExcerpt }, sourceAvailable: true });
  }
  return { proposals, notices };
}
