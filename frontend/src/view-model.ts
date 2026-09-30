// Presentation-only types. They are not an API or a replacement for shared domain contracts.
export type ConnectionState = "online" | "offline" | "checking";
export type RecordsLoadState = "ready" | "loading" | "error";
export type OperationState = "none" | "needs_confirmation" | "saving" | "saved" | "failed" | "unknown";
export type GuideStatus = "first_login" | "incomplete" | "complete" | "unknown";

export interface HomeChild {
  accessRole?: "owner" | "caregiver" | "viewer";
  id: string;
  displayName: string;
  ageLabel: string;
  // Optional display projection; preserve the full label and its approximate/date semantics.
  ageSummaryLabel?: string;
  ageReferenceLabel?: string;
  regionLabel: string;
  allergiesLabel: string | null;
  profileConfirmed: boolean;
}

export interface HomeRecord {
  id: string;
  childId: string;
  kind: "sleep" | "feeding" | "measurement" | "note" | "appointment";
  title: string;
  detail: string;
  eventTimeLabel: string;
  confirmedAtLabel: string;
}

export interface HomeOperation {
  state: OperationState;
  title: string;
  detail: string;
}

export interface HomeViewModel {
  caregiverName: string;
  children: HomeChild[];
  selectedChildId: string | null;
  connection: ConnectionState;
  recordsLoad: RecordsLoadState;
  profileLoad: RecordsLoadState;
  records: HomeRecord[];
  lastReadLabel: string | null;
  operation: HomeOperation;
  guideStatus: GuideStatus;
}

export type HomeDestination = "chat" | "care" | "profile" | "family" | "memory" | "settings" | "guide" | "tasks" | "photos" | "sources" | "growth";

export interface HomeActions {
  selectChild(id: string): void;
  refresh(): void;
  reviewOperation(): void;
  open(destination: HomeDestination): void;
  composeCare(kind: HomeRecord["kind"]): void;
  prepareQuestion(question: string): void;
  createChildPreview(displayName: string): void;
  deleteChildPreview(childId: string): void;
  completeGuidePreview(): void;
}
