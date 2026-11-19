import { matchOfficialHelpForText, type OfficialHelpId } from "../src/shared/agent-feedback.ts";
import type { TurnBackgroundAssembly, TurnConversationMode } from "./agent-context-assembly.ts";
import { isPureGreetingOrSmallTalk } from "./chat-delivery-review.ts";
import { knowledgeTokens } from "./knowledge-ranking.ts";

export type DailyNeedSignalKind = "missing_condition" | "known_constraint_reminder" | "relevant_blindspot";

export interface DailyNeedSignal {
  readonly id: string;
  readonly kind: DailyNeedSignalKind;
  readonly whyNow: string;
  readonly gentlePrompt: string;
  readonly knownBasis: readonly string[];
  readonly unknownOrLimits: readonly string[];
  readonly sourceRef?: {
    readonly kind: "memory_fact" | "growth_attention" | "concern";
    readonly id: string;
    readonly version?: number;
  };
  readonly skippable: true;
}

export interface DailyNeedsDiscoveryResult {
  readonly suppressedForUrgency: boolean;
  readonly urgentOfficialHelpIds: readonly OfficialHelpId[];
  readonly signals: readonly DailyNeedSignal[];
  readonly suggestOptionalDiscussion: boolean;
  readonly optionalDiscussionReason: string | null;
  readonly discussionAutoStarted: false;
  readonly canMutateTasksOrMemory: false;
  readonly mode: TurnConversationMode;
}

const DOMAIN_CONSTRAINT_CUE = /(?:食|飲|餵|加固|糊|湯|零食|餐|奶|水果|蛋|奶製品|花生|麩質|塗|搽|藥|發燒|出疹|皮膚|洗澡|外出|\b(?:diet|eat|feed|food|solid|milk|snack|skin|medication|allerg)\b)/iu;
const AGE_DEPENDENT_TOPIC_CUE = /(?:食幾多|加固|糊仔|奶量|睡眠時間|瞓幾耐|發燒|退燒|疫苗|打針|發展|行路|講嘢|刷牙|幾歲|幾多個月|\b(?:solid\s+food|weaning|sleep\s+schedule|fever|vaccine|milestone|dosage)\b)/iu;
const CJK_AGE_AMOUNT = /(?:歲半|(?:\d+(?:\.\d+)?|[零〇一二兩三四五六七八九十半]+)\s*(?:個?月|星期|週|周|歲半?))/giu;
const CHILD_BEFORE_AGE = /(?:BB|寶寶|嬰兒|小朋友|孩子|小孩|我個[仔女]|仔仔|囡囡|月齡|年齡)\s*(?:(?:而家|依家|宜家|現在|今年|剛滿|剛好|啱啱|已經|約|係|是|為|[:：])\s*)*$/iu;
const CHILD_AFTER_AGE = /^\s*(?:嘅|的)?\s*(?:BB|寶寶|嬰兒|小朋友|孩子|小孩)/iu;

function statesChildAge(text: string): boolean {
  const normalized = text.normalize("NFKC");
  if (/(?:初生|新生兒)|\bnewborn\b/iu.test(normalized)) return true;
  if (/\b\d+(?:\.\d+)?[\s-]*(?:days?|weeks?|months?|years?)[\s-]+old\b/iu.test(normalized)
    || /\b(?:baby|child|son|daughter|he|she)\s+(?:is|turned)\s+(?:now\s+)?\d+(?:\.\d+)?\s+(?:days?|weeks?|months?|years?)\b(?!\s+(?:ago|later|into|behind|ahead)\b)/iu.test(normalized)) return true;
  for (const match of normalized.matchAll(CJK_AGE_AMOUNT)) {
    const before = normalized.slice(0, match.index);
    const after = normalized.slice(match.index + match[0].length);
    // An elapsed interval is not the child's current age, even directly after "BB".
    if (/(?:最近|過去|持續|連續|已經持續|相隔|隔咗|維持咗)\s*$/u.test(before)
      || /^\s*(?:(?:之|以)?[前後]|以來|內|期間|都|一直|冇|沒有|未有|沒)/u.test(after)) continue;
    // A terse age followed immediately by a care question is a common direct-age opening.
    const opensQuestion = !before.trim() && /^\s*[,，、]\s*(?:可唔可以|可以|應唔應該|應該|食幾多|幾時)/u.test(after);
    if (match[0].includes("歲") || /^\s*(?:大|齡)/u.test(after)
      || CHILD_BEFORE_AGE.test(before) || CHILD_AFTER_AGE.test(after) || opensQuestion) return true;
  }
  return false;
}
const TRADE_OFF_TOPIC_PATTERN = /(?:戒尿片|戒奶嘴|分房睡|睡眠訓練|BLW|傳統餵食|揀幼稚園|選校|興趣班|管教方式|點揀好|利弊|取捨|\b(?:trade[-\s]?off|sleep\s+training|potty\s+training|baby[-\s]?led\s+weaning)\b)/iu;

const GROWTH_TOPIC_PATTERNS: Readonly<Record<string, RegExp>> = {
  solid_food: /(?:食|飲|餵|加固|糊|副食|固體|奶|\b(?:food|solid|feed|wean)\b)/iu,
  toddler_play: /(?:玩|遊戲|玩具|講嘢|說話|語言|溝通|繪本|睇書|電視|螢幕|\b(?:play|language|speech|book|screen)\b)/iu,
  preschool_development: /(?:幼稚園|學前|專注|群體|行為|情緒|發展|老師|\b(?:preschool|develop|behavio(?:u)?r|attention)\b)/iu,
  school_vision: /(?:眼|視力|睇嘢|近視|閱讀|小一|學校|驗眼|\b(?:vision|eye|glasses|reading)\b)/iu,
};

/**
 * Discovers relevant everyday care needs, missing conditions, and blind spots during ordinary
 * conversation without requiring optional multi-role discussion (REQ-008 §1.2).
 * Urgent official help always takes precedence, and signals never auto-save tasks, facts, or notifications.
 */
export function discoverDailyNeeds(input: {
  readonly userText: string;
  readonly background: TurnBackgroundAssembly;
  readonly now?: Date;
}): DailyNeedsDiscoveryResult {
  const { userText, background } = input;
  const trimmed = userText.trim();
  const helpIds = matchOfficialHelpForText(trimmed);

  if (helpIds.includes("emergency-hk-v1")) {
    return {
      suppressedForUrgency: true,
      urgentOfficialHelpIds: helpIds,
      signals: [],
      suggestOptionalDiscussion: false,
      optionalDiscussionReason: null,
      discussionAutoStarted: false,
      canMutateTasksOrMemory: false,
      mode: background.mode,
    };
  }

  if (!trimmed || isPureGreetingOrSmallTalk(trimmed)) {
    return {
      suppressedForUrgency: false,
      urgentOfficialHelpIds: helpIds,
      signals: [],
      suggestOptionalDiscussion: false,
      optionalDiscussionReason: null,
      discussionAutoStarted: false,
      canMutateTasksOrMemory: false,
      mode: background.mode,
    };
  }

  const signals: DailyNeedSignal[] = [];

  if (background.mode !== "ephemeral" && background.relevantFacts.status === "provided" && DOMAIN_CONSTRAINT_CUE.test(trimmed)) {
    for (const fact of background.relevantFacts.items) {
      if (fact.matchReason !== "safety_constraint") continue;
      signals.push({
        id: `fact-constraint:${fact.id}`,
        kind: "known_constraint_reminder",
        whyNow: `此問題涉及飲食、皮膚或用藥日常安排，而系統已存有經確認的過敏／限制事項（${fact.key}）。`,
        gentlePrompt: `留意配對已知已確認條件「${fact.content}」，揀選或處理時可一併避開相關風險；如這項條件有更新亦可告知更正。`,
        knownBasis: [`已確認記憶（ID ${fact.id} v${fact.version}）：${fact.key}`],
        unknownOrLimits: ["此溫和提示只依據已確認資料，未推測家庭實際操作，可隨時略過。"],
        sourceRef: { kind: "memory_fact", id: fact.id, version: fact.version },
        skippable: true,
      });
      break;
    }
  }

  const needsAgeClarification =
    AGE_DEPENDENT_TOPIC_CUE.test(trimmed)
    && !statesChildAge(trimmed)
    && (
      background.mode === "ephemeral"
      || background.childProfile.status === "empty_authorized"
      || background.childProfile.status === "read_failed"
      || background.childProfile.agePrecision === "unknown"
      || background.childProfile.agePrecision === "approximate"
      || background.childProfile.agePrecision === null
    );

  if (needsAgeClarification) {
    const isApprox = background.childProfile.agePrecision === "approximate";
    const isFailed = background.childProfile.status === "read_failed";
    const isEphemeral = background.mode === "ephemeral";
    const unknownNote = isEphemeral
      ? "臨時對話不會載入孩子檔案；可直接在今次訊息說明月齡，退出後不會寫入長期記錄。"
      : isFailed
        ? "目前未能讀取孩子檔案，系統沒有假設出生日期或年齡；沒有記錄不代表家長漏做或孩子異常。"
        : isApprox
          ? "目前檔案只載有約數年齡，未推算確切出生日期；涉及月齡邊界時仍須先核實實際月齡。"
          : "目前檔案尚未記錄適用年齡；沒有記錄不代表家長漏做或孩子異常。";
    signals.push({
      id: "missing-age-condition",
      kind: "missing_condition",
      whyNow: "今次問題的飲食、睡眠、用藥或發展建議高度取決於實際月齡。",
      gentlePrompt: "答完基本重點後，可順帶補充孩子目前幾多個月大，方便比對最貼合的適用範圍；不補充亦會先交代現有資料限制。",
      knownBasis: isApprox && background.childProfile.ageMonthsMin !== null
        ? [`約數年齡提示（約 ${background.childProfile.ageMonthsMin} 個月，非精準出生日期）`]
        : [],
      unknownOrLimits: [unknownNote],
      skippable: true,
    });
  }

  if (background.mode !== "ephemeral" && background.activeFocus.status === "provided") {
    const disabledSet = new Set(background.activeFocus.disabledGrowthTopics);
    for (const growth of background.activeFocus.growthItems) {
      if (disabledSet.has(growth.topicId)) continue;
      const pattern = GROWTH_TOPIC_PATTERNS[growth.topicId];
      if (!pattern || !pattern.test(trimmed)) continue;
      signals.push({
        id: `growth-focus:${growth.id}`,
        kind: "relevant_blindspot",
        whyNow: `目前有一項進行中的階段性成長關注（${growth.topicId}），與今次提問主題直接相關。`,
        gentlePrompt: "除眼前回覆外，亦可視需要查看該成長階段的官方留意重點或是否已有相關安排。",
        knownBasis: [`已授權活躍成長關注（topicId=${growth.topicId}）`],
        unknownOrLimits: ["沒有記錄不代表家長漏做或孩子異常；提示只供參考，不會自動建立待辦或發送通知。"],
        sourceRef: { kind: "growth_attention", id: growth.id },
        skippable: true,
      });
      break;
    }

    const queryTokens = knowledgeTokens(trimmed, true);
    if (queryTokens.size > 0) {
      for (const concern of background.activeFocus.openConcerns) {
        if (concern.status !== "following") continue;
        const concernTokens = knowledgeTokens(concern.title, false);
        let overlap = false;
        for (const token of queryTokens) {
          if (concernTokens.has(token)) { overlap = true; break; }
        }
        if (!overlap) continue;
        signals.push({
          id: `concern-focus:${concern.id}`,
          kind: "relevant_blindspot",
          whyNow: `目前有一個跟進中關注項目與本輪話題重疊，可一併留意先前的觀察脈絡。`,
          gentlePrompt: "如有需要可順便對照該跟進關注的已有觀察；若暫時毋須處理可直接略過。",
          knownBasis: [`活躍持續關注（ID ${concern.id}）`],
          unknownOrLimits: ["沒有記錄不代表家長漏做或孩子異常；討論或提醒均不會自動改寫待辦或記憶。"],
          sourceRef: { kind: "concern", id: concern.id },
          skippable: true,
        });
        break;
      }
    }
  }

  const suggestOptionalDiscussion = TRADE_OFF_TOPIC_PATTERN.test(trimmed);
  return {
    suppressedForUrgency: false,
    urgentOfficialHelpIds: helpIds,
    signals: signals.slice(0, 2),
    suggestOptionalDiscussion,
    optionalDiscussionReason: suggestOptionalDiscussion
      ? "這個育兒話題常見不同取捨與做法比較；如有需要，你可以自行選擇展開多角度討論，不展開亦不影響一般協助。"
      : null,
    discussionAutoStarted: false,
    canMutateTasksOrMemory: false,
    mode: background.mode,
  };
}
