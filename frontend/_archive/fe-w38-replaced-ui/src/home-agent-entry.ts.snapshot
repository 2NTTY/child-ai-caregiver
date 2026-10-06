import type { PhotoOriginal } from "./photo-view-model";
import type { HomeViewModel } from "./view-model";

// Local presentation ownership only; this is not an upload or Agent request.
export function homeAgentScope(model: Pick<HomeViewModel, "children" | "selectedChildId" | "caregiverName">): string | null {
  const child = model.children.find(item => item.id === model.selectedChildId);
  return child ? JSON.stringify([model.caregiverName, child.id, child.accessRole ?? null]) : null;
}

export function createHomeAgentPhotoHandoff() {
  let pending: { scope: string; photo: PhotoOriginal } | null = null;
  function clear() {
    const photo = pending?.photo;
    pending = null;
    photo?.dispose?.();
  }
  return {
    stage(scope: string, photo: PhotoOriginal) {
      if (pending?.photo !== photo) clear();
      pending = { scope, photo };
    },
    retainScope(scope: string | null) { if (pending && pending.scope !== scope) clear(); },
    take(scope: string | null): PhotoOriginal | null {
      if (!pending) return null;
      if (!scope || pending.scope !== scope) { clear(); return null; }
      const photo = pending.photo;
      pending = null;
      return photo;
    },
    clear,
  };
}
