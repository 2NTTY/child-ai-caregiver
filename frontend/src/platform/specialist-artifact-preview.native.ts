import type { SpecialistPreviewFormat, SpecialistPreviewLoader, SpecialistPreviewSession } from "./specialist-artifact-preview-contract.ts";

export function openSpecialistArtifactPreview(_format: SpecialistPreviewFormat, _fileName: string,
  _load: SpecialistPreviewLoader, _current: () => boolean): SpecialistPreviewSession {
  // There is no in-app native renderer. Do not open a share chooser or write a private draft to cache.
  return {
    close() {},
    ready: Promise.reject(new Error("App 暫不支援安全開啟這份草稿，請用網頁版預覽。")),
  };
}
