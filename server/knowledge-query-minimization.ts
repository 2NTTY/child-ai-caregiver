import { FamilyError } from "./family-access.ts";

export type ExternalQueryPrivacyViolationKind =
  | "contact_or_url"
  | "numeric_identifier"
  | "full_birth_date"
  | "street_or_home_address"
  | "personal_name_or_transcript";

const GENERIC_CARE_TERMS = new Set([
  "bb",
  "baby",
  "child",
  "infant",
  "toddler",
  "kid",
  "mom",
  "mum",
  "dad",
  "寶寶",
  "嬰兒",
  "幼兒",
  "小朋友",
  "孩子",
  "兒童",
  "小童",
  "兒子",
  "女兒",
  "仔仔",
  "女女",
  "媽媽",
  "爸爸",
  "家長",
  "母親",
  "父親",
]);

const URL_OR_EMAIL_PATTERN =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(?<!\S)@[A-Za-z0-9_.-]{2,}|\bhttps?:\/\/|\bwww\.[A-Za-z0-9.-]+\.[A-Za-z]{2,}/iu;
const MESSAGING_HANDLE_PATTERN =
  /\b(?:(?:whatsapp|wechat|telegram)\s*(?:[:：=]\s*[@+\w.-]{2,}|\+?\d{6,})|(?:line|ig|instagram|signal)\s*(?:(?:id|帳號|賬號|戶口|handle)\s*[:：=]?\s*[@A-Za-z0-9_.-]{2,}|[:：=]\s*(?:@[A-Za-z0-9_.-]{2,}|\+?\d{6,})))/iu;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f-]{27}/iu;
const GUIDELINE_YEAR_RANGE_PATTERN = /\b(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}\b/gu;
const PHONE_OR_ID_DIGIT_RUN_PATTERN = /(?<!\d)(?:\d{8,}|\d{4}[ -]\d{4})(?!\d)/u;
const HK_COUNTRY_PHONE_PATTERN = /\+?852[\s-]?\d{4}[\s-]?\d{4}\b/u;

const FULL_BIRTH_DATE_PATTERNS: readonly RegExp[] = [
  /(?:19|20)\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*[日號]/u,
  /(?:19|20)\d{2}[./-]\d{1,2}[./-]\d{1,2}/u,
  /\b\d{1,2}[./-]\d{1,2}[./-](?:19|20)\d{2}\b/u,
  /\b(?:\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(?:19|20)\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+(?:19|20)\d{2})\b/iu,
  /(?:出生日期|出生年月日|出生於|生於|生日|DOB|date\s+of\s+birth)\s*[:：=]?\s*(?:(?:19|20)\d{2}(?:\s*年\s*\d{1,2}\s*月)?|\d{1,2}\s*月\s*\d{1,2}\s*[日號]|\d{1,2}[./-]\d{1,2})/iu,
];

const STREET_OR_ADDRESS_PATTERNS: readonly RegExp[] = [
  /(?:地址|住址|居住地址|通訊地址)\s*[:：=]\s*\S+/iu,
  // Coarse regions like "住喺沙田區" / "住在香港" stay allowed; block only when concrete estate/street/unit tokens follow.
  /(?:屋企住|屋企喺|家住|住喺|住在)\s*[^\s，,。]{0,12}(?:邨|新邨|屋苑|居屋|花園|豪庭|山莊|太古城|第一城|康城|名城|新都城|樓(?!(?:梯|上|下))|閣|座|室|單位|街|道|路|巷|里|號|\d+)/iu,
  // Estate + building block names while excluding generic "城市/樓梯" phrasing and keeping civic districts like "沙田區".
  /(?:[\u4e00-\u9fff]{1,10}(?:邨|新邨|屋苑|居屋|花園|豪庭|山莊)|(?:太古|沙田第一|第一|日出康|康|皇|名|新都|愉景|海怡|麗港)城)\s*[\u4e00-\u9fff0-9A-Za-z]{1,10}(?:樓(?!(?:梯|上|下|層))|閣|座|苑|臺|軒|期)/u,
  /[\u4e00-\u9fffA-Za-z]{2,14}(?:大街|大道|大馬路|街|道|路|巷|里)\s*\d+\s*(?:[A-Za-z]?號|no\.?)/iu,
  /\b\d{1,5}\s+[A-Za-z][A-Za-z0-9'\s-]{1,25}\s+(?:Street|St|Road|Rd|Avenue|Ave|Lane|Drive|Dr|Court|Ct|Terrace)\b/iu,
  // Floor + flat/unit or block + floor/unit markers; avoids blocking generic clinic floors like "3樓", "Room 1", "Block 3 playground", or "急症室".
  /(?:\d+\s*(?:\/F|樓)|地下|G\/F)\s*(?:\d+[A-Za-z]?|[A-Za-z]\d*)\s*(?:室|號室|單位)/iu,
  /(?:\d+|[一二三四五六七八九十]+)\s*(?:座|棟|幢)\s*(?:\d+\s*(?:樓|層)|(?:\d+[A-Za-z]?|[A-Za-z])\s*(?:室|單位))/u,
  /(?<![\u4e00-\u9fffA-Za-z0-9])(?:\d{3,4}|[A-H]\d{0,2})\s*(?:號室|室|單位)/u,
  /\b(?:[Ff]lat|FLAT|[Rr]m|RM|[Uu]nit|UNIT|[Aa]pt|APT)\s*[#:]?\s*(?:\d+[A-Za-z]?|[A-Z])(?![A-Za-z])/u,
  /\b\d{1,3}\s*\/\s*F\s*,\s*(?:Block|Blk|Tower)\s*[A-Za-z0-9]+\b|\b(?:Block|Blk|Tower)\s*[A-Za-z0-9]+\s*,\s*\d{1,3}\s*\/\s*F\b/iu,
];

const PERSONAL_NAME_OR_TRANSCRIPT_PATTERNS: readonly RegExp[] = [
  /(?:姓名|名字|全名|真實姓名|家長姓名|家長名稱|兒童姓名|孩子姓名|BB姓名|寶寶姓名|病人姓名|聯絡人)\s*[:：=]\s*[\u4e00-\u9fffA-Za-z]/iu,
  /(?:身份證|身分證|護照|病歷號|患者編號|\bhkid\b)(?:號碼)?\s*(?:[:：=]\s*[A-Za-z0-9(]|\s+[A-Z]{0,2}\d{5,})/iu,
  /(?:我的|家長|聯絡)(?:電話|手機|手提)(?:號碼)?\s*[:：=]\s*[\d+]/iu,
  /(?:我|本人|我個(?:仔|女)|我小朋友|孩子|寶寶|BB|bb)\s*(?:叫做|名叫)|(?:個名|名字)(?:係|叫)\s*[\u4e00-\u9fffA-Za-z]/u,
  // Require non-verb/non-kinship target after bare "叫" so "BB叫唔停" / "寶寶叫媽媽" / "孩子叫痛" stay allowed.
  /(?:^|[\s，,。;；])(?:我|本人|我個(?:仔|女)|我小朋友|孩子|寶寶|BB|bb)\s*叫\s*(?!(?:唔|咗|左|了|到|極|痛|醒|停|喊|哭|聲|叫|爸|媽|爹|娘|母|父|爺|嫲|公|婆|哥|姐|妹|弟|白車|救護車|醫生|護|人|大聲|埋|出|好|做))([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20})?|[\u4e00-\u9fff]{2,4})(?=$|[\s，,。！!？?；;])/u,
  /\b(?:my\s+name\s+is|my\s+(?:son|daughter|child|baby)(?:'s\s+name)?\s+is)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/iu,
  /\b(?:Mr|Mrs|Ms|Miss)\.?\s+[A-Z][a-z]{1,20}\b/u,
  /[\u4e00-\u9fff]{1,2}(?:先生|太太|女士|小姐)/u,
  // Require multi-turn transcript shape rather than single-line conversational prefixes like "媽媽：BB發燒點算".
  /(?:^|\n)\s*(?:user|assistant|model|家長|爸爸|媽媽|助手)\s*[:：][^\n]*\n+\s*(?:user|assistant|model|家長|爸爸|媽媽|助手)\s*[:：]/imu,
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsKnownPrivateIdentifier(normalizedQuery: string, knownPrivateIdentifiers?: readonly string[]): boolean {
  if (!knownPrivateIdentifiers?.length) return false;
  const lowered = normalizedQuery.toLowerCase();
  for (const raw of knownPrivateIdentifiers) {
    const candidate = raw.normalize("NFKC").trim();
    if (candidate.length < 2) continue;
    if (GENERIC_CARE_TERMS.has(candidate.toLowerCase())) continue;
    if (/^[A-Za-z][A-Za-z\s.'-]*$/u.test(candidate)) {
      const latinPattern = new RegExp(`(?<![A-Za-z])${escapeRegExp(candidate)}(?![A-Za-z])`, "iu");
      if (latinPattern.test(normalizedQuery)) return true;
      continue;
    }
    if (lowered.includes(candidate.toLowerCase())) return true;
  }
  return false;
}

function hasNumericIdentifier(normalized: string): boolean {
  const withoutYearRanges = normalized.replace(GUIDELINE_YEAR_RANGE_PATTERN, " ");
  return PHONE_OR_ID_DIGIT_RUN_PATTERN.test(withoutYearRanges) || HK_COUNTRY_PHONE_PATTERN.test(withoutYearRanges);
}

/**
 * Deterministic outbound transport guard for third-party knowledge search queries (REQ-001 §4.1).
 * Blocks identifiable personal payloads before query embeddings or store searches execute;
 * retaining minimized search terms does not claim or guarantee anonymization.
 */
export function findExternalQueryPrivacyViolation(
  query: string,
  knownPrivateIdentifiers?: readonly string[],
): ExternalQueryPrivacyViolationKind | null {
  const normalized = query.normalize("NFKC");
  if (URL_OR_EMAIL_PATTERN.test(normalized) || UUID_PATTERN.test(normalized) || MESSAGING_HANDLE_PATTERN.test(normalized)) {
    return "contact_or_url";
  }
  if (hasNumericIdentifier(normalized)) {
    return "numeric_identifier";
  }
  if (FULL_BIRTH_DATE_PATTERNS.some(pattern => pattern.test(normalized))) {
    return "full_birth_date";
  }
  if (STREET_OR_ADDRESS_PATTERNS.some(pattern => pattern.test(normalized))) {
    return "street_or_home_address";
  }
  if (containsKnownPrivateIdentifier(normalized, knownPrivateIdentifiers)
    || PERSONAL_NAME_OR_TRANSCRIPT_PATTERNS.some(pattern => pattern.test(normalized))) {
    return "personal_name_or_transcript";
  }
  return null;
}

export function assertPublicKnowledgeQuery(query: string, knownPrivateIdentifiers?: readonly string[]): string {
  if (findExternalQueryPrivacyViolation(query, knownPrivateIdentifiers) !== null) {
    throw new FamilyError(400, "public_query_required");
  }
  return query;
}
