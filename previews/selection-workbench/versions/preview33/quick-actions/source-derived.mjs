// SOURCE-DERIVED: pinned project helpers, TypeScript types erased only.
// This helper is not the production chat text owner or an upload/navigation service.

// frontend/src/assistant-draft.ts
                                                           
                                                                        

// Transient presentation boundary, not a server attachment or upload contract.
                                   
                                                                                                  
                                                                                                                                             
  
                                                                                                                 
export const emptyAssistantDraft                 = { scope: null, text: "", attachments: [] };
export function canPreviewAssistantDraft(draft                                              ) {
  return !!draft.text.trim() || draft.attachments.some(item => item.bytes > 0);
}
export function photoAttachment(photo               )                      {
  return { id: `photo-${Date.now()}-${++attachmentSerial}`, kind: "photo", fileName: photo.fileName,
    mimeType: photo.mimeType, bytes: photo.bytes, photo, dispose: photo.dispose };
}
let attachmentSerial = 0;
export function localAttachmentId() { return `local-${Date.now()}-${++attachmentSerial}`; }

export function createAssistantDraftOwner() {
  let snapshot                 = emptyAssistantDraft;
  const texts = new Map                ();
  const listeners = new Set            ();
  const emit = () => listeners.forEach(listener => listener());
  const release = (attachments                                ) => attachments.forEach(item => item.dispose?.());
  const valid = (scope               ) => !!scope && scope === snapshot.scope;
  return {
    subscribe(listener            ) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    retainScope(scope               ) {
      if (snapshot.scope === scope) return;
      release(snapshot.attachments);
      snapshot = { scope, text: scope ? texts.get(scope) ?? "" : "", attachments: [] }; emit();
    },
    setText(scope               , text        ) {
      if (!valid(scope)) return;
      texts.set(scope , text); snapshot = { ...snapshot, text }; emit();
    },
    add(scope               , attachment                     , replaceId         ) {
      if (!valid(scope) || attachment.bytes <= 0) { attachment.dispose?.(); return false; }
      if (snapshot.attachments.includes(attachment)) return true;
      const existing = snapshot.attachments.find(item => item.id === replaceId);
      if (existing && existing !== attachment) existing.dispose?.();
      snapshot = { ...snapshot, attachments: existing ? snapshot.attachments.map(item => item.id === replaceId ? attachment : item) : [...snapshot.attachments, attachment] };
      emit(); return true;
    },
    remove(scope               , id        ) {
      if (!valid(scope)) return;
      const selected = snapshot.attachments.find(item => item.id === id);
      selected?.dispose?.(); snapshot = { ...snapshot, attachments: snapshot.attachments.filter(item => item.id !== id) }; emit();
    },
    clearAttachments(scope               ) {
      if (!valid(scope) || snapshot.attachments.length === 0) return;
      release(snapshot.attachments); snapshot = { ...snapshot, attachments: [] }; emit();
    },
    clear(scope               ) {
      if (!valid(scope)) return;
      release(snapshot.attachments); texts.delete(scope ); snapshot = { scope, text: "", attachments: [] }; emit();
    },
    forget(scope               ) {
      if (!scope) return;
      texts.delete(scope);
      if (snapshot.scope === scope) { release(snapshot.attachments); snapshot = { scope, text: "", attachments: [] }; emit(); }
    },
    dispose() { release(snapshot.attachments); snapshot = emptyAssistantDraft; texts.clear(); listeners.clear(); },
  };
}

// frontend/src/home-agent-entry.ts
                                                  

// Local presentation ownership only; this is not an upload or Agent request.
export function homeAgentScope(model                                                                                    )                {
  if (model.scopeKey !== undefined) return model.scopeKey;
  const child = model.children.find(item => item.id === model.selectedChildId);
  return child ? JSON.stringify([model.caregiverName, child.id, child.accessRole ?? null]) : null;
}

// frontend/src/components/navigation/quick-input-gesture.ts
// Local direction selection only. A release opens input; it never submits a draft.
                                                       
export function quickInputDirection(dx        , dy        )                        {
  const distance = Math.hypot(dx, dy);
  if (distance < 34 || distance > 190 || dx < -24 || dy > 24) return null;
  const angle = Math.atan2(-dy, dx) * 180 / Math.PI;
  if (angle >= 67.5 && angle <= 105) return "file";
  if (angle >= 22.5 && angle < 67.5) return "voice";
  if (angle >= -15 && angle < 22.5) return "text";
  return null;
}
export function recordsMoreDirection(dx        , dy        )          {
  return dy <= -36 && dy >= -190 && Math.abs(dx) <= 60;
}
