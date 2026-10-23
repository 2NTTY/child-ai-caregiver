// Presentation-only models. The formal ChildProfile and transport stay authoritative.
export const profileAgeOptions = [
  { value: "unknown", label: "未知" }, { value: "birth_date", label: "出生日期" },
  { value: "approximate", label: "約數年齡" },
] as const;
export const profileAgeUnitOptions = [
  { value: "days", label: "日" }, { value: "weeks", label: "星期" },
  { value: "months", label: "個月" }, { value: "years", label: "歲" },
] as const;
export type ProfileAgeKind = typeof profileAgeOptions[number]["value"];
export type ProfileAgeUnit = typeof profileAgeUnitOptions[number]["value"];
export type ProfileAgeView = { kind: "unknown" } | { kind: "birth_date"; date: string }
  | { kind: "approximate"; rawValue: string; unit: ProfileAgeUnit; asOf: string };
export interface ProfileDataView {
  age: ProfileAgeView;
  dueDate: string | null;
  gestationalWeeksRaw: string | null;
  region: string | null;
  language: string | null;
  allergies: string | null;
  specialNeeds: string | null;
  preferences: string | null;
  source: string;
  validUntil: string | null;
}
export interface ProfileFormValues {
  ageKind: ProfileAgeKind;
  birthDate: string;
  ageRaw: string;
  ageUnit: ProfileAgeUnit;
  ageAsOf: string;
  dueDate: string;
  gestationalWeeksRaw: string;
  region: string;
  language: string;
  allergies: string;
  specialNeeds: string;
  preferences: string;
  source: string;
  validUntil: string;
  reason: string;
}
export interface ProfileRevisionView {
  version: number;
  data: ProfileDataView | null;
  confirmedByLabel: string | null;
  confirmedAtLabel: string | null;
  reason: string | null;
}
export interface ProfileViewModel {
  child: { id: string; name: string } | null;
  access: "editable" | "read_only" | "lost";
  online: boolean;
  reading: boolean;
  needsRefresh: boolean;
  current: ProfileRevisionView | null;
  basis: ProfileRevisionView | null;
  latest: ProfileRevisionView | null;
  history: ProfileRevisionView[];
  historyOpen: boolean;
  hasMoreHistory: boolean;
  initialValues: ProfileFormValues;
  formKey: number;
  reviewedValues: ProfileFormValues | null;
  intent: "save" | "delete" | null;
  operation: { state: "none" | "needs_confirmation" | "saving" | "saved" | "failed" | "unknown" | "conflict"; message: string; reference: string | null; resultUnavailable?: boolean };
  notice: string | null;
}
export interface ProfileActions {
  reviewDraft(values: ProfileFormValues): void;
  editDraft(): void;
  cancelReview(): void;
  discardDraft?(): void;
  submitReviewed(): void;
  reviewDeletion(): void;
  useLatestVersion(): void;
  showHistory(): void;
  loadOlderHistory(): void;
  refresh(): void;
}
export const emptyProfileForm = (): ProfileFormValues => ({
  ageKind: "unknown", birthDate: "", ageRaw: "", ageUnit: "months", ageAsOf: "",
  dueDate: "", gestationalWeeksRaw: "", region: "", language: "", allergies: "",
  specialNeeds: "", preferences: "", source: "", validUntil: "", reason: "",
});
export function profileFormFromData(data: ProfileDataView | null): ProfileFormValues {
  if (!data) return emptyProfileForm();
  return {
    ageKind: data.age.kind,
    birthDate: data.age.kind === "birth_date" ? data.age.date : "",
    ageRaw: data.age.kind === "approximate" ? data.age.rawValue : "",
    ageUnit: data.age.kind === "approximate" ? data.age.unit : "months",
    ageAsOf: data.age.kind === "approximate" ? data.age.asOf : "",
    dueDate: data.dueDate ?? "", gestationalWeeksRaw: data.gestationalWeeksRaw ?? "",
    region: data.region ?? "", language: data.language ?? "", allergies: data.allergies ?? "",
    specialNeeds: data.specialNeeds ?? "", preferences: data.preferences ?? "",
    source: data.source, validUntil: data.validUntil ?? "", reason: "",
  };
}
export function profileDataFromForm(values: ProfileFormValues): ProfileDataView {
  const optional = (value: string) => value === "" ? null : value;
  return {
    age: values.ageKind === "unknown" ? { kind: "unknown" }
      : values.ageKind === "birth_date" ? { kind: "birth_date", date: values.birthDate }
        : { kind: "approximate", rawValue: values.ageRaw, unit: values.ageUnit, asOf: values.ageAsOf },
    dueDate: optional(values.dueDate), gestationalWeeksRaw: optional(values.gestationalWeeksRaw),
    region: optional(values.region), language: optional(values.language), allergies: optional(values.allergies),
    specialNeeds: optional(values.specialNeeds), preferences: optional(values.preferences),
    source: values.source, validUntil: optional(values.validUntil),
  };
}
