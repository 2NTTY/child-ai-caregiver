// Presentation-only types. They are not an API or a replacement for shared domain contracts.
export type ConnectionState = "online" | "offline" | "checking";
export type RecordsLoadState = "ready" | "loading" | "error";
export type OperationState = "none" | "needs_confirmation" | "saving" | "saved" | "failed" | "unknown";

export interface HomeChild {
  id: string;
  displayName: string;
  ageLabel: string;
  regionLabel: string;
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
  records: HomeRecord[];
  lastReadLabel: string | null;
  operation: HomeOperation;
}

export type HomeDestination = "chat" | "care" | "profile" | "family" | "memory";

export interface HomeActions {
  selectChild(id: string): void;
  refresh(): void;
  reviewOperation(): void;
  open(destination: HomeDestination): void;
}
