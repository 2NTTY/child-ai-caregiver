export const CARE_KINDS = ["note", "feeding", "sleep", "diaper", "temperature", "measurement", "appointment"] as const;
export type CareKind = typeof CARE_KINDS[number];
export interface CareDetails {
  kind: CareKind;
  quantity: { rawValue: string; unit: string; precision: "exact" | "approximate" } | null;
  eventTime: { rawText: string; at: string | null; timeZone: string; precision: "exact" | "approximate" | "unknown" };
}
export interface CareValues { text: string; details: CareDetails; source: string }
export interface CareRevision extends CareValues {
  version: number; confirmedBy: string; confirmedAt: string; reason: string;
  confirmationBasis?: "explicit" | "preauthorized_user_statement";
}
export interface CareRecord extends CareRevision { id: string; childId: string; authorUserId: string; createdAt: string }
export interface CareCursor { createdAt: string; id: string; changeSeq?: string }
export interface CarePage { records: CareRecord[]; nextCursor: CareCursor | null; scanned: number; limit: number }
export type AgeBasis = { kind: "unknown" } | { kind: "birth_date"; date: string }
  | { kind: "approximate"; rawValue: string; unit: "days" | "weeks" | "months" | "years"; asOf: string };
export interface ChildProfileData {
  age: AgeBasis; dueDate: string | null; gestationalWeeksRaw: string | null;
  region: string | null; language: string | null; allergies: string | null;
  specialNeeds: string | null; preferences: string | null; source: string; validUntil: string | null;
}
export interface ChildProfile {
  childId: string; version: number; data: ChildProfileData | null;
  confirmedBy: string | null; confirmedAt: string | null; reason: string | null;
}
export interface CareSearch { query?: string; kind?: CareKind; cursor?: CareCursor }
export interface HistoryPage<T> { revisions: T[]; nextBeforeVersion: number | null }
export const emptyCareDetails = (kind: CareKind = "note"): CareDetails => ({ kind, quantity: null,
  eventTime: { rawText: "", at: null, timeZone: "Asia/Hong_Kong", precision: "unknown" } });
