import type { ImageSourcePropType } from "react-native";
import type { CareKind } from "./care-view-model";

// Display projections of src/shared/photos.ts at master 5098d64, not a second API contract.
export const photoLimits = { bytes: 4 * 1024 * 1024, childBytes: 100 * 1024 * 1024, childCount: 100 } as const;
export type PhotoDraftFields = { text: string; kind: CareKind; rawValue: string; unit: string; approximate: boolean; timeRaw: string };
export type PhotoCandidate = PhotoDraftFields & { uncertainties: readonly string[] };
export type PhotoOriginal = {
  fileName: string; mimeType: "image/jpeg" | "image/png"; bytes: number; sha256: string;
  imageSource: ImageSourcePropType;
  readBase64?: () => Promise<string>;
  dispose?: () => void;
};
export type PhotoItem = {
  id: string; childId: string; fileName: string; mimeType: PhotoOriginal["mimeType"]; bytes: number; sha256: string;
  source: string; ownerLabel: string; isUploader: boolean; createdAtLabel: string; version: number; canManage: boolean;
  state: "reserved" | "ready"; visibility: "private" | "shared"; recordId: string | null;
  imageSource: ImageSourcePropType | null;
  extraction: { state: "not_requested" | "running" | "available" | "failed" | "unknown"; candidate: PhotoCandidate | null };
};
export type PhotoPhase = "reserve" | "upload" | "extract" | "confirm" | "delete";
export type PhotoOperation = {
  state: "none" | "saving" | "saved" | "failed" | "unknown" | "unconfirmed" | "conflict" | "confirmed_unavailable";
  phase: PhotoPhase | null; reference: string | null; message: string; checked: boolean;
};
export type PhotoReplacement = { kind: "original"; original: PhotoOriginal } | { kind: "item"; item: PhotoItem } | { kind: "clear" };
export type PhotosViewModel = {
  childName: string; online: boolean; access: "editable" | "read_only" | "lost";
  load: "ready" | "loading" | "error"; canCreate: boolean; capacityReached: boolean;
  items: readonly PhotoItem[]; selected: PhotoItem | null; latest: PhotoItem | null;
  original: PhotoOriginal | null; source: string; sourceError: string; draft: PhotoDraftFields; formKey: number;
  reviewed: PhotoDraftFields | null; modelConsent: boolean; sharedConsent: boolean;
  operation: PhotoOperation; notice: string; reservationUnidentified: boolean;
  replacement: PhotoReplacement | null; deletion: boolean; deleteScope: boolean; deleteFinal: boolean;
  busy: boolean; fresh: boolean; formLocked: boolean; canPick: boolean; canUpload: boolean; canExtract: boolean; canConfirm: boolean; canDelete: boolean;
};
export type PhotosActions = {
  pickOriginal: (original: PhotoOriginal) => void; reportFileError: (message: string) => void;
  openPhoto: (item: PhotoItem) => void; clearEditor: () => void;
  confirmReplacement: () => void; cancelReplacement: () => void;
  editSource: (source: string) => void; upload: () => void; refresh: () => void;
  setModelConsent: (checked: boolean) => void; extract: () => void; adoptCandidate: () => void;
  editDraft: (draft: PhotoDraftFields) => void; reviewDraft: (draft: PhotoDraftFields) => void;
  setSharedConsent: (checked: boolean) => void; confirmShared: () => void;
  checkOriginal: () => void; retryOriginal: () => void; finishUnidentified: () => void; useLatest: () => void;
  openDeletion: () => void; closeDeletion: () => void;
  setDeleteScope: (checked: boolean) => void; setDeleteFinal: (checked: boolean) => void; deletePhoto: () => void;
};
export const emptyPhotoDraft = (): PhotoDraftFields => ({ text: "", kind: "note", rawValue: "", unit: "", approximate: false, timeRaw: "" });
export const photoExtractionLabels: Record<PhotoItem["extraction"]["state"], string> = {
  not_requested: "未要求提取", running: "正在提取", available: "有待核對候選", failed: "提取失敗", unknown: "提取結果未知",
};
export function samePhotoOriginal(photo: Pick<PhotoOriginal, "mimeType" | "bytes" | "sha256">, original: PhotoOriginal) {
  return photo.mimeType === original.mimeType && photo.bytes === original.bytes && photo.sha256 === original.sha256;
}
