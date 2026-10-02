// Presentation models only. The formal CareValues and transport remain authoritative.
export const careKindOptions = [
  { value: "note", label: "日常觀察", icon: "notebook-outline" },
  { value: "feeding", label: "飲食", icon: "silverware-fork-knife" },
  { value: "sleep", label: "睡眠", icon: "weather-night" },
  { value: "diaper", label: "如廁／尿片", icon: "baby-face-outline" },
  { value: "temperature", label: "體溫", icon: "thermometer" },
  { value: "measurement", label: "身高／體重", icon: "ruler" },
  { value: "appointment", label: "預約", icon: "calendar-outline" },
] as const;

export type CareKind = typeof careKindOptions[number]["value"];
export type CareFilter = CareKind | "all";
export type CareWriteState = "none" | "needs_confirmation" | "saving" | "saved" | "failed" | "unknown" | "conflict";
export type CareListState = "ready" | "loading" | "loading_more" | "error" | "stale";

export interface CareFormValues {
  kind: CareKind;
  text: string;
  source: string;
  quantityRaw: string;
  quantityUnit: string;
  quantityPrecision: "exact" | "approximate";
  eventTimeRaw: string;
  reason: string;
}

export interface CareRevisionView {
  version: number;
  values: CareFormValues;
  eventTimePrecision: "exact" | "approximate" | "unknown";
  timeZoneLabel: string;
  confirmedByLabel: string;
  confirmedAtLabel: string;
}

export interface CareRecordView {
  id: string;
  childId: string;
  title: string;
  createdAtLabel: string;
  current: CareRevisionView;
  history: CareRevisionView[];
}

export interface CareDraftView {
  key: string;
  mode: "create" | "revise";
  basis: CareRecordView | null;
  initialValues: CareFormValues;
  reviewedValues: CareFormValues | null;
}

export interface CareRecordsViewModel {
  child: { id: string; name: string; summary: string };
  access: "editable" | "read_only" | "lost";
  online: boolean;
  dataLabel: string;
  list: {
    state: CareListState;
    records: CareRecordView[];
    activeQuery: string;
    activeKind: CareFilter;
    scanned: number;
    hasMore: boolean;
    message: string | null;
  };
  detail: {
    record: CareRecordView;
    historyOpen: boolean;
    history: CareRevisionView[];
    historyLoading: boolean;
    hasMoreHistory: boolean;
  } | null;
  draft: CareDraftView | null;
  deletion: { basis: CareRecordView; scopeConfirmed: boolean } | null;
  operation: {
    kind?: "delete";
    state: CareWriteState;
    message: string;
    reference: string | null;
    latest: CareRecordView | null;
  };
  submitLabel: string;
  checkLabel: string;
}

export interface CareRecordsActions {
  search(query: string, kind: CareFilter): void;
  loadMore(): void;
  openRecord(id: string): void;
  closePanel(): void;
  startCreate(): void;
  startCorrection(id: string): void;
  startDeletion(id: string): void;
  confirmDeletionScope(checked: boolean): void;
  submitDeletion(): void;
  showHistory(): void;
  loadOlderHistory(): void;
  reviewDraft(values: CareFormValues): void;
  editDraft(): void;
  submitReviewed(): void;
  checkOriginalOperation(): void;
  useLatestVersion(): void;
}

export const emptyCareForm = (): CareFormValues => ({
  kind: "note", text: "", source: "", quantityRaw: "", quantityUnit: "",
  quantityPrecision: "approximate", eventTimeRaw: "", reason: "",
});
