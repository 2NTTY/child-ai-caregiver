import type { PhotoOriginal } from "./photo-view-model.ts";
import type { PhotoMessageReference } from "../../src/shared/photos.ts";

// Transient presentation boundary, not a server attachment or upload contract.
export type AssistantAttachment = {
  id: string; kind: "photo" | "file" | "voice"; fileName: string; mimeType: string; bytes: number;
  photo?: PhotoOriginal; photoReference?: PhotoMessageReference; localUri?: string; readBase64?: () => Promise<string>; dispose?: () => void;
};
export type AssistantDraft = { scope: string | null; text: string; attachments: readonly AssistantAttachment[] };
export const emptyAssistantDraft: AssistantDraft = { scope: null, text: "", attachments: [] };
export function canPreviewAssistantDraft(draft: Pick<AssistantDraft, "text" | "attachments">) {
  return !!draft.text.trim() || draft.attachments.some(item => item.bytes > 0);
}
export function photoAttachment(photo: PhotoOriginal): AssistantAttachment {
  return { id: `photo-${Date.now()}-${++attachmentSerial}`, kind: "photo", fileName: photo.fileName,
    mimeType: photo.mimeType, bytes: photo.bytes, photo, dispose: photo.dispose };
}
let attachmentSerial = 0;
export function localAttachmentId() { return `local-${Date.now()}-${++attachmentSerial}`; }

export function createAssistantDraftOwner() {
  let snapshot: AssistantDraft = emptyAssistantDraft;
  const texts = new Map<string, string>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(listener => listener());
  const release = (attachments: readonly AssistantAttachment[]) => attachments.forEach(item => item.dispose?.());
  const valid = (scope: string | null) => !!scope && scope === snapshot.scope;
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    retainScope(scope: string | null) {
      if (snapshot.scope === scope) return;
      release(snapshot.attachments);
      snapshot = { scope, text: scope ? texts.get(scope) ?? "" : "", attachments: [] }; emit();
    },
    setText(scope: string | null, text: string) {
      if (!valid(scope)) return;
      texts.set(scope!, text); snapshot = { ...snapshot, text }; emit();
    },
    add(scope: string | null, attachment: AssistantAttachment, replaceId?: string) {
      if (!valid(scope) || attachment.bytes <= 0) { attachment.dispose?.(); return false; }
      if (snapshot.attachments.includes(attachment)) return true;
      const existing = snapshot.attachments.find(item => item.id === replaceId);
      if (existing && existing !== attachment) existing.dispose?.();
      snapshot = { ...snapshot, attachments: existing ? snapshot.attachments.map(item => item.id === replaceId ? attachment : item) : [...snapshot.attachments, attachment] };
      emit(); return true;
    },
    remove(scope: string | null, id: string) {
      if (!valid(scope)) return;
      const selected = snapshot.attachments.find(item => item.id === id);
      selected?.dispose?.(); snapshot = { ...snapshot, attachments: snapshot.attachments.filter(item => item.id !== id) }; emit();
    },
    clearAttachments(scope: string | null) {
      if (!valid(scope) || snapshot.attachments.length === 0) return;
      release(snapshot.attachments); snapshot = { ...snapshot, attachments: [] }; emit();
    },
    clear(scope: string | null) {
      if (!valid(scope)) return;
      release(snapshot.attachments); texts.delete(scope!); snapshot = { scope, text: "", attachments: [] }; emit();
    },
    forget(scope: string | null) {
      if (!scope) return;
      texts.delete(scope);
      if (snapshot.scope === scope) { release(snapshot.attachments); snapshot = { scope, text: "", attachments: [] }; emit(); }
    },
    dispose() { release(snapshot.attachments); snapshot = emptyAssistantDraft; texts.clear(); listeners.clear(); },
  };
}
