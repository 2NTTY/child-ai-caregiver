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

const URL_OR_EMAIL_PATTERN = /@|https?:|\bwww\./iu;
const MESSAGING_HANDLE_PATTERN = /\b(?:whatsapp|wechat|signal|telegram|line|ig)\s*(?:[:：@=]|\+?\d{4,})/iu;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f-]{27}/iu;
const LONG_DIGIT_RUN_PATTERN = /(?:\d[ .-]?){8}/u;
const HK_COUNTRY_PHONE_PATTERN = /\+?852[\s-]?\d{4,}/u;

const FULL_BIRTH_DATE_PATTERNS: readonly RegExp[] = [
  /(?:19|20)\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*[日號]/u,
  /(?:19|20)\d{2}[./-]\d{1,2}[./-]\d{1,2}/u,
  /\b\d{1,2}[./-]\d{1,2}[./-](?:19|20)\d{2}\b/u,
  /\b(?:\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(?:19|20)\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+(?:19|20)\d{2})\b/iu,
  /(?:出生日期|出生年月日|出生於|生於|生日|DOB|date\s+of\s+birth)\s*[:：=]?\s*(?:(?:19|20)\d{2}(?:\s*年\s*\d{1,2}\s*月)?|\d{1,2}\s*月\s*\d{1,2}\s*[日號]|\d{1,2}[./-]\d{1,2})/iu,
];

const STREET_OR_ADDRESS_PATTERNS: readonly RegExp[] = [
  /(?:地址|住址|居住地址|通訊地址)\s*[:：=]\s*\S+/iu,
  /(?:屋企住|屋企喺|家住|住喺|住在)\s*[\u4e00-\u9fffA-Za-z0-9]/iu,
  // Estate + building/tower block names (e.g., 瀝源邨福海樓, 太古城海天閣) while avoiding civic districts alone (e.g., 沙田區).
  /[\u4e00-\u9fff]{1,12}(?:邨|新邨|屋苑|居屋|花園|豪庭|山莊|城)\s*[\u4e00-\u9fff0-9A-Za-z]{1,12}(?:樓|閣|座|苑|臺|軒|期)/u,
  /[\u4e00-\u9fffA-Za-z]{2,14}(?:大街|大道|大馬路|街|道|路|巷|里)\s*\d+\s*(?:[A-Za-z]?號|no\.?)/iu,
  /\b\d{1,5}\s+[A-Za-z][A-Za-z0-9'\s-]{1,25}\s+(?:Street|St|Road|Rd|Avenue|Ave|Lane|Drive|Dr|Court|Ct|Terrace)\b/iu,
  // Floor/flat/unit markers requiring explicit unit/floor digits or unit letters so public rooms like 急症室 remain allowed.
  /(?:(?:\d+|[A-Za-z])\s*(?:室|號室|單位)|(?:\d+|[一二三四五六七八九十]+)\s*(?:座|棟|幢)\s*(?:\d+|[A-Za-z])?\s*(?:樓|層|室|單位)|\d+\s*(?:\/F|樓)|\d+\s*層\s*(?:[A-Za-z0-9一二三]+\s*(?:室|單位)|座)|\b(?:Flat|Room|Rm|Unit|Floor|Block|Tower)\s*[#:]?\s*[A-Za-z0-9-]+\b)/iu,
];

const PERSONAL_NAME_OR_TRANSCRIPT_PATTERNS: readonly RegExp[] = [
  /(?:姓名|名字|全名|真實姓名|家長姓名|家長名稱|兒童姓名|孩子姓名|BB姓名|寶寶姓名|病人姓名|聯絡人|身份證|身分證|護照|病歷號|患者編號)\s*[:：=]?\s*[\u4e00-\u9fffA-Za-z0-9]/iu,
  /\bhkid\b/iu,
  /(?:我的|家長|聯絡)(?:電話|手機|手提)(?:號碼)?\s*[:：=]?\s*[\d+]/iu,
  /(?:我叫|我叫做|本人叫|我個仔叫|我個女叫|我小朋友叫|孩子叫|寶寶叫|BB叫)\s*[\u4e00-\u9fffA-Za-z]{1,12}/iu,
  /\b(?:my\s+name\s+is|my\s+(?:son|daughter|child|baby)(?:'s\s+name)?\s+is)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/iu,
  /\b(?:Mr|Mrs|Ms|Miss)\.?\s+[A-Z][a-z]{1,20}\b/u,
  /[\u4e00-\u9fff]{1,2}(?:先生|太太|女士|小姐)/u,
  /(?:^|\n)\s*(?:user|assistant|model|家長|爸爸|媽媽|助手)\s*[:：]/imu,
];

function containsKnownPrivateIdentifier(normalizedQuery: string, knownPrivateIdentifiers?: readonly string[]): boolean {
  if (!knownPrivateIdentifiers?.length) return false;
  const lowered = normalizedQuery.toLowerCase();
  for (const raw of knownPrivateIdentifiers) {
    const candidate = raw.normalize("NFKC").trim();
    if (candidate.length < 2) continue;
    if (GENERIC_CARE_TERMS.has(candidate.toLowerCase())) continue;
    if (lowered.includes(candidate.toLowerCase())) return true;
  }
  return false;
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
  if (LONG_DIGIT_RUN_PATTERN.test(normalized) || HK_COUNTRY_PHONE_PATTERN.test(normalized)) {
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
