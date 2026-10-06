import type { HomeViewModel } from "./view-model";

// Local presentation ownership only; this is not an upload or Agent request.
export function homeAgentScope(model: Pick<HomeViewModel, "children" | "selectedChildId" | "caregiverName">): string | null {
  const child = model.children.find(item => item.id === model.selectedChildId);
  return child ? JSON.stringify([model.caregiverName, child.id, child.accessRole ?? null]) : null;
}
