import type { photoConfirmationProjection } from "./components/photos/photo-form";
import type { PhotoCandidate, PhotoDraftFields } from "./photo-view-model";
import type { SourceIntake, SourceIntakeActions, SourceIntakeView } from "./source-intake";
import type { SourceManagement, SourceManagementRevision } from "../../src/shared/shared-inputs";

// Display projections of ce87370 SharedInputPanel/shared-inputs.ts, not a second wire contract.
export type SourceCreateKind = "personal_source" | "paste" | "public_source";
export type SourceConfirmationKind = "reference" | "family_record";
export type PublicInputSource = { id: string; url: string; publisher: string };
export type SourceCreate = { kind: "personal_source"; sourceLabel: string; sourceUrl: string | null; sourceDateText: string | null; sourceNotes: string; text: string }
  | { kind: "paste"; sourceLabel: string; sourceUrl: string | null; sourceDateText: string | null; text: string }
  | { kind: "public_source"; sourceId: string };
export type SourceInput = {
  id: string; childId: string; ownerUserId: string; version: number; createdAt: string; canManage: boolean;
  kind: SourceCreateKind; sourceNotes: string; sourceId: string | null; sourceLabel: string; sourceUrl: string | null; sourceDateText: string | null;
  text: string; sha256: string | null; retrievedAt: string | null;
  fetchState: "not_requested" | "running" | "ready" | "failed" | "unknown";
  extraction: { state: "not_requested" | "running" | "available" | "failed" | "unknown"; runId: string | null; excerpt: string | null;
    draft: PhotoCandidate | null; stopReason: string | null; processedAt: string | null; model: string | null };
  recordId: string | null; confirmationKind: SourceConfirmationKind | null;
  management?: SourceManagement | null;
};
export type SourceConfirmation = { expectedVersion: number; confirmShared: true; kind: SourceConfirmationKind; confirmChildFact: boolean; values: ReturnType<typeof photoConfirmationProjection> };
export type SourcePhase = "create" | "fetch" | "extract" | "confirm" | "delete" | "manage";
export type SourceOperation = {
  state: "none" | "needs_confirmation" | "saving" | "saved" | "failed" | "unknown" | "unconfirmed" | "conflict" | "confirmed_unavailable";
  phase: SourcePhase | null; reference: string | null; message: string; checked: boolean;
};
export type SourceDirect = { kind: "fetch" | "extract"; basisVersion: number; excerpt: string; checked: boolean };
export type SourcePersonalContent = Extract<SourceCreate, { kind: "personal_source" }>;
export type SourceManagementDraft = { management: SourceManagement; modelPermission: boolean; modelExcerpt: string; reason: string; content: SourcePersonalContent | null; dirty: boolean };
export type SourceManagementHistory = { load: "idle" | "loading" | "ready" | "error"; revisions: readonly SourceManagementRevision[]; hasMore: boolean };
export type SourcesViewModel = {
  // Intake is a display draft; only the management adapter constructs a wire request.
  intake?: SourceIntakeView; intakeByInputId?: Readonly<Record<string, SourceIntake>>;
  managementDraft?: SourceManagementDraft | null; managementHistory?: SourceManagementHistory;
  scopeKey: string; childName: string; accountName: string; online: boolean; access: "editable" | "read_only" | "lost";
  load: "ready" | "loading" | "error"; canCreate: boolean; items: readonly SourceInput[]; sources: readonly PublicInputSource[];
  selected: SourceInput | null; latest: SourceInput | null; operation: SourceOperation; direct: SourceDirect | null; notice: string;
  draft: PhotoDraftFields; draftUncertainties: readonly string[]; formKey: number; reviewed: PhotoDraftFields | null; confirmationKind: SourceConfirmationKind;
  composerSeed: SourceInput | null; excerpt: string; fetchConsent: boolean; modelConsent: boolean; sharedConsent: boolean; childFactConsent: boolean;
  deleteOpen: boolean; deleteScope: boolean; deleteFinal: boolean;
  // A successful reading snapshot stays visible while controls are locked by a background GET.
  readFresh?: boolean;
  busy: boolean; fresh: boolean; formLocked: boolean; canChoose: boolean; canFetch: boolean; canExtract: boolean; canConfirm: boolean; canDelete: boolean;
};
export type SourcesActions = {
  intake?: SourceIntakeActions;
  management?: {
    edit(patch: Partial<SourceManagement>): void; setModelPermission(value: boolean): void; setModelExcerpt(value: string): void; setReason(value: string): void;
    beginContentEdit(): void; editContent(value: SourcePersonalContent): void; cancelContentEdit(): void; history(): void;
  };
  discardDraft?(kind: "composer" | "record" | "management"): void;
  refresh(): void; create(input: SourceCreate): void; openInput(input: SourceInput): void; newInput(): void; recreateWithText(): void;
  setFetchConsent(value: boolean): void; fetchContent(): void; setExcerpt(value: string): void; setModelConsent(value: boolean): void; extract(): void;
  adoptCandidate(): void; editDraft(draft: PhotoDraftFields): void; reviewDraft(draft: PhotoDraftFields): void;
  setConfirmationKind(kind: SourceConfirmationKind): void; setSharedConsent(value: boolean): void; setChildFactConsent(value: boolean): void; confirm(): void;
  checkOriginal(): void; retryOriginal(): void; finishUnavailable(): void; retryDirect(): void; endDirect(): void; useLatest(): void;
  openDeletion(): void; closeDeletion(): void; setDeleteScope(value: boolean): void; setDeleteFinal(value: boolean): void; remove(): void;
};
export const fetchStateLabels: Record<SourceInput["fetchState"], string> = { not_requested: "未要求取得", running: "正在取得正文", ready: "正文已保存", failed: "取得失敗", unknown: "取得結果未知" };
