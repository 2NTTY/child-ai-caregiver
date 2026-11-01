import type { HomeTarget } from "./home-target";
import type { HomeOverviewView } from "./home-overview.ts";
import type { PhotoOriginal } from "./photo-view-model.ts";

// Presentation-only types. They are not an API or a replacement for shared domain contracts.
export type ConnectionState = "online" | "offline" | "checking";
export type RecordsLoadState = "ready" | "loading" | "error";
export type OperationState = "none" | "needs_confirmation" | "saving" | "saved" | "failed" | "unknown";
export type GuideStatus = "first_login" | "incomplete" | "complete" | "not_required" | "unknown";

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

// The adapter selects an authorized focus. Missing data is not an empty task list.
export type HomeFocusView =
  | { kind: "none"; detail?: string }
  | { kind: "unavailable"; detail: string }
  | { kind: "task" | "growth"; title: string; detail: string; whyNow?: string; sourceLabel?: string;
      action: { label: string; target: HomeTarget } };

export interface HomeViewModel {
  // A production owner supplies a stable server/user/session/child/role scope.
  scopeKey?: string | null;
  caregiverName: string;
  children: HomeChild[];
  selectedChildId: string | null;
  connection: ConnectionState;
  recordsLoad: RecordsLoadState;
  profileLoad: RecordsLoadState;
  records: HomeRecord[];
  lastReadLabel: string | null;
  operation: HomeOperation;
  focus?: HomeFocusView;
  overview?: HomeOverviewView;
  guideStatus: GuideStatus;
}

export type HomeDestination = "chat" | "care" | "profile" | "family" | "memory" | "settings" | "guide" | "tasks" | "photos" | "sources" | "growth" | "summary" | "contact";

export interface HomeActions {
  selectChild(id: string): void;
  openChildProfile(id: string): void;
  refresh(): void;
  reviewOperation(): void;
  open(destination: HomeDestination | HomeTarget): void;
  openAgentPhoto(original: PhotoOriginal): void;
  composeCare(kind: HomeRecord["kind"]): void;
  prepareQuestion(question: string): void;
  createChildPreview(displayName: string): void;
  deleteChildPreview(childId: string): void;
  completeGuidePreview(): void;
}

// Display-only operation projection; the original domain controller retains the request and receipt.
export interface WriteOperationView {
  state: OperationState | "conflict";
  message: string;
  reference: string | null;
  referenceLabel?: string;
  recovery?: "check" | "retry" | "reload";
  resultUnavailable?: boolean;
}
export interface WriteRecoveryActions {
  checkOriginalOperation?(): void;
  retryOriginalOperation?(): void;
  reloadCurrent?(): void;
}
