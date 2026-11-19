export const HIGH_RISK_CARE_POLICY_VERSION = "req008-highrisk-care-policy/1" as const;

export type HighRiskCareCategory =
  | "medication_dosing"
  | "emergency_triage_safety"
  | "infant_safety_restriction"
  | "clinical_directive_diagnosis";

export type ChatDeliveryShortPathExemption =
  | "server_substituted_source"
  | "server_substituted_receipt"
  | "server_allowlisted_emergency_entry"
  | "pure_greeting"
  | "pure_clarification"
  | "ordinary_uncited_non_care"
  | null;

export type ChatDeliveryReviewTriggerReason =
  | "high_risk_care_claim"
  | "cited_official_claim"
  | "cited_claim"
  | "official_kind_claim"
  | "scope_refusal_verification"
  | "verified_operation_summary_check"
  | "private_reference_claim"
  | "substantive_care_advice"
  | "media_or_original_evidence"
  | "unverified_operation_or_state_claim"
  | "sticky_run_obligation";

export interface HighRiskCareMatch {
  readonly policyVersion: typeof HIGH_RISK_CARE_POLICY_VERSION;
  readonly matched: boolean;
  readonly categories: readonly HighRiskCareCategory[];
  readonly requiresOfficialEvidence: boolean;
}

export interface ChatDeliveryReviewPolicyEvaluation {
  readonly policyVersion: typeof HIGH_RISK_CARE_POLICY_VERSION;
  readonly requiresReview: boolean;
  readonly obligationReason: "review" | "evidence" | "citation" | "official_citation" | null;
  readonly requiresOfficialEvidence: boolean;
  readonly shortPathExemption: ChatDeliveryShortPathExemption;
  readonly highRiskCategories: readonly HighRiskCareCategory[];
  readonly triggerReasons: readonly ChatDeliveryReviewTriggerReason[];
}

const QTY_TOKEN = String.raw`(?:\d+(?:\.\d+)?\s*\/\s*\d+|\d+(?:\.\d+)?|[¼½¾]|半|[\d一二三四五六七八九十兩两零〇幾]+)`;
const MED_UNIT_TOKEN = String.raw`(?:粒|片|包|滴|茶?匙|小?匙|大?匙|平?匙|湯?匙|藥匙|匙羹|顆|丸|支|劑|管|噴|吸|貼|枚|微克|毫克|毫升|公克|ml|mg|mcg|ug|iu|cc)`;

const MEDICATION_DOSING_PATTERN = new RegExp([
  String.raw`(?:保嬰丹|七星茶|開奶茶|塞肛藥|肛門栓劑|退熱栓|退燒栓|栓劑|收鼻水藥|抗敏感藥|抗組織胺|類固醇藥膏|類固醇|眼藥水|滴耳藥|退燒藥|退熱藥|消炎藥|抗生素|止咳藥水?|止瀉藥|撲熱息痛|必理痛|布洛芬|阿士匹靈|中藥|成藥|餵藥|食藥|吃藥|服藥|用藥|藥水|藥丸|藥粉|劑量)`,
  String.raw`\b(?:paracetamol|acetaminophen|tylenol|ibuprofen|aspirin|antibiotics?|antihistamines?|steroid\s+creams?|suppositor(?:y|ies)|eye\s+drops?|ear\s+drops?|cough\s+(?:syrup|medicine)|herbal\s+medicine|dosage|dosing)\b`,
  String.raw`\b\d+(?:\.\d+)?\s*(?:ml|mg|mcg|ug|iu|cc)\b|\d+(?:\.\d+)?\s*(?:毫升|毫克|微克)`,
  String.raw`(?:每次|每日|每天|每\s*${QTY_TOKEN}\s*(?:小時|個?鐘)|一日)\s*(?:餵|食|吃|服|飲|用|塗|搽|滴|吸)?\s*(?:約|大約|大概)?\s*${QTY_TOKEN}\s*${MED_UNIT_TOKEN}`,
].join("|"), "iu");

const EMERGENCY_TRIAGE_SAFETY_PATTERN = new RegExp([
  String.raw`(?:鯁喉|嗆喉|噎到|異物梗塞|海姆立克|伸手入喉嚨|用手.{0,8}(?:挖|掏).{0,6}(?:喉嚨|異物)|拍背按胸)`,
  String.raw`(?:抽筋|抽搐|發羊吊|熱性痙攣|呼吸困難|嘴唇發紫|面青|發紺|缺氧|失去意識|意識喪失|意識模糊|叫唔醒|無晒反應|昏迷|腦震盪|撞親頭.{0,14}(?:瞓覺|睡覺|觀察|無事|唔使)|跌落床.{0,14}(?:瞓覺|睡覺|觀察|無事|唔使))`,
  String.raw`(?:燙傷|燒傷|灼傷).{0,16}(?:搽|敷|塗|冰敷|牙膏|豉油|醬油|牛油|蛋白|刺穿水泡|弄穿水泡)|(?:搽|敷|塗)(?:牙膏|豉油|醬油|牛油).{0,12}(?:燙傷|燒傷|灼傷|降溫)`,
  String.raw`(?:誤服|吞(?:咗|左|了)?(?:異物|電池|鈕扣電池|硬幣|藥|清潔劑|漂白水)|催吐|飲水沖落去|灌水|灌奶)`,
  String.raw`\b(?:choking|heimlich|finger\s+sweep|airway\s+obstruction|seizures?|convulsions?|difficulty\s+breathing|blue\s+lips|cyanosis|unresponsive|loss\s+of\s+consciousness|concussion)\b`,
  String.raw`\b(?:burns?|scalds?)\b.{0,30}\b(?:toothpaste|soy\s+sauce|butter|ice|pop\s+(?:the\s+)?blister)\b`,
  String.raw`\bswallowed\s+(?:a\s+)?(?:battery|coin|magnet|medicine|detergent|bleach)\b|\binduce\s+vomiting\b|\bpoison(?:ing)?\b`,
].join("|"), "iu");

const INFANT_SAFETY_RESTRICTION_PATTERN = new RegExp([
  String.raw`(?:蜂蜜|蜜糖|肉毒桿菌|\bhoney\b|\bbotulism\b)`,
  String.raw`(?:趴睡|俯睡|趴低.{0,8}(?:瞓|睡|休息)|趴喺度.{0,8}(?:瞓|睡|休息)|同床睡|俯臥睡|\bprone\s+sleep\b|\bsleep\s+face\s+down\b|\bon\s+(?:their|his|her)\s*(?:stomach|tummy|belly)\b)`,
  String.raw`(?:火酒|酒精|冰水).{0,12}(?:抹身?|擦身?|敷|沖涼?|降溫|散熱)|(?:禁食|禁飲|禁水|禁飲食|禁飲禁食|停食|停水|停奶|停餵|停止(?:飲水|喝水|補水|飲奶|餵奶|進食))`,
  String.raw`\b(?:rubbing\s+alcohol|ice\s+bath)\b|\bnil[\s-]+by[\s-]+mouth\b|\bnpo\b|\bwithhold\s+(?:fluids?|water|milk|feeds?)\b`,
  String.raw`(?:新生兒|初生|嬰兒|BB|寶寶|未滿一歲|六個月以下).{0,18}(?:加鹽|純牛奶|鮮奶|飲水|整粒提子|原粒提子|整粒堅果|花生粒|爆谷)|加鹽.{0,12}(?:新生兒|初生|嬰兒|BB|寶寶)`,
  String.raw`\b(?:whole\s+grapes?|whole\s+nuts?|popcorn)\b.{0,24}\b(?:baby|infant|toddler)\b|\b(?:newborn|infant|baby)\b.{0,24}\b(?:add\s+salt|cow'?s\s+milk|give\s+water)\b`,
].join("|"), "iu");

const CLINICAL_DIRECTIVE_DIAGNOSIS_PATTERN = new RegExp([
  String.raw`(?:唔使睇醫生|不用睇醫生|不用看醫生|不用就醫|毋須求醫|無需求醫|毋須就醫|無需就診|唔洗睇醫生|可以唔使睇醫生)`,
  String.raw`(?:肯定(?:唔係|不是)(?:過敏|敏感|發燒|感染|麻疹|手足口|肺炎)|一定(?:無事|無大礙|唔係過敏|唔係感染)|應該無大礙.{0,12}(?:觀察|唔使|不用)|放心.{0,12}(?:唔使睇醫生|不用就醫|繼續食|自然好))`,
  String.raw`(?:(?:自行|可以|應該?)?(?:停用|停食|停服|中斷)(?:抗生素|處方藥|類固醇|哮喘藥)|(?:唔使|不用|無需|延遲|跳過)(?:打針|接種|打疫苗))`,
  String.raw`\b(?:no\s+need\s+to\s+(?:see|visit|consult)|don'?t\s+need\s+to\s+(?:see|visit|consult)|skip\s+seeing|(?:do\s+not|don'?t|never|need\s+not)\s+(?:see|visit|go\s+to|consult))\s+(?:a\s+)?doctor\b`,
  String.raw`\b(?:definitely\s+not\s+(?:an?\s+)?(?:allergy|infection|fever|measles)|certainly\s+harmless)\b`,
  String.raw`\b(?:stop\s+taking\s+(?:antibiotics?|prescribed\s+meds?|medication)|(?:skip|delay)\s+(?:the\s+)?vaccin(?:e|ation))\b`,
].join("|"), "iu");

/**
 * Evaluates formalized REQ-008 §3.3 high-risk pediatric care rules over normalized text.
 * Neutral words such as bare "覆診", "醫生", "診所", "傷口", or "癒合" alone do not trigger.
 */
export function detectHighRiskCareClaims(text: string): HighRiskCareMatch {
  const normalized = text.normalize("NFKC").trim();
  if (!normalized) {
    return {
      policyVersion: HIGH_RISK_CARE_POLICY_VERSION,
      matched: false,
      categories: [],
      requiresOfficialEvidence: false,
    };
  }
  const categories: HighRiskCareCategory[] = [];
  if (MEDICATION_DOSING_PATTERN.test(normalized)) categories.push("medication_dosing");
  if (EMERGENCY_TRIAGE_SAFETY_PATTERN.test(normalized)) categories.push("emergency_triage_safety");
  if (INFANT_SAFETY_RESTRICTION_PATTERN.test(normalized)) categories.push("infant_safety_restriction");
  if (CLINICAL_DIRECTIVE_DIAGNOSIS_PATTERN.test(normalized)) categories.push("clinical_directive_diagnosis");
  return {
    policyVersion: HIGH_RISK_CARE_POLICY_VERSION,
    matched: categories.length > 0,
    categories,
    requiresOfficialEvidence: categories.length > 0,
  };
}

export type HighRiskCalibrationBucket =
  | "high_risk_direct"
  | "high_risk_mixed_evasion"
  | "safe_short_path"
  | "safe_benign_non_care";

export interface HighRiskPolicyCalibrationCase {
  readonly id: string;
  readonly bucket: HighRiskCalibrationBucket;
  readonly evaluation: ChatDeliveryReviewPolicyEvaluation;
  readonly actualRequiresOfficialEvidence: boolean;
  readonly expectedRequiresReview: boolean;
  readonly expectedRequiresOfficialEvidence: boolean;
  readonly expectedCategories?: readonly HighRiskCareCategory[];
  readonly expectedShortPathExemption?: ChatDeliveryShortPathExemption;
}

export interface HighRiskPolicyMatrixReport {
  readonly policyVersion: typeof HIGH_RISK_CARE_POLICY_VERSION;
  readonly totalCases: number;
  readonly falseNegatives: readonly string[];
  readonly falsePositives: readonly string[];
  readonly categoryMismatches: readonly string[];
  readonly evidenceGateMismatches: readonly string[];
  readonly shortPathMismatches: readonly string[];
  readonly buckets: Readonly<Record<HighRiskCalibrationBucket, { total: number; passed: number }>>;
  readonly passed: boolean;
}

/**
 * Evaluates false-negative, false-positive, category, official-evidence gate, and
 * short-path exemption accuracy across a labeled calibration corpus.
 */
export function evaluateHighRiskPolicyMatrix(
  cases: readonly HighRiskPolicyCalibrationCase[],
): HighRiskPolicyMatrixReport {
  const falseNegatives: string[] = [];
  const falsePositives: string[] = [];
  const categoryMismatches: string[] = [];
  const evidenceGateMismatches: string[] = [];
  const shortPathMismatches: string[] = [];
  const buckets: Record<HighRiskCalibrationBucket, { total: number; passed: number }> = {
    high_risk_direct: { total: 0, passed: 0 },
    high_risk_mixed_evasion: { total: 0, passed: 0 },
    safe_short_path: { total: 0, passed: 0 },
    safe_benign_non_care: { total: 0, passed: 0 },
  };

  for (const item of cases) {
    buckets[item.bucket].total += 1;
    let itemOk = true;

    if (item.expectedRequiresReview && !item.evaluation.requiresReview) {
      falseNegatives.push(item.id);
      itemOk = false;
    } else if (!item.expectedRequiresReview && item.evaluation.requiresReview) {
      falsePositives.push(item.id);
      itemOk = false;
    }

    if (item.expectedCategories) {
      const actualSet = new Set(item.evaluation.highRiskCategories);
      const allPresent = item.expectedCategories.every(cat => actualSet.has(cat));
      if (!allPresent) {
        categoryMismatches.push(item.id);
        itemOk = false;
      }
    }

    if (
      item.actualRequiresOfficialEvidence !== item.expectedRequiresOfficialEvidence
      || (item.expectedRequiresOfficialEvidence && !item.evaluation.requiresOfficialEvidence)
    ) {
      evidenceGateMismatches.push(item.id);
      itemOk = false;
    }

    if (
      item.expectedShortPathExemption !== undefined
      && item.evaluation.shortPathExemption !== item.expectedShortPathExemption
    ) {
      shortPathMismatches.push(item.id);
      itemOk = false;
    }

    if (itemOk) buckets[item.bucket].passed += 1;
  }

  return {
    policyVersion: HIGH_RISK_CARE_POLICY_VERSION,
    totalCases: cases.length,
    falseNegatives,
    falsePositives,
    categoryMismatches,
    evidenceGateMismatches,
    shortPathMismatches,
    buckets,
    passed:
      falseNegatives.length === 0
      && falsePositives.length === 0
      && categoryMismatches.length === 0
      && evidenceGateMismatches.length === 0
      && shortPathMismatches.length === 0,
  };
}
