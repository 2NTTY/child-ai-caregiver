import { useGlobalSearchParams, usePathname } from "expo-router";
import { Platform } from "react-native";
import { useCareWorkspace } from "../workspaces/CareWorkspace";
import { useProfileWorkspace } from "../workspaces/ProfileWorkspace";
import { useTasksWorkspace } from "../workspaces/TasksWorkspace";
import { useGrowthWorkspace } from "../workspaces/GrowthWorkspace";
import { useMemoryReferenceWorkspace } from "../workspaces/MemoryReferenceWorkspace";
import { routeStartupReadiness, routeStartupRequirements, startupReadState as readState, targetStartupReadiness } from "../startup/dataReadiness";
import { useProductionStartupReadiness, useProductionVisibleSettingsSection } from "./ProductionFirstScreenGate";
import { usePersonalHistoryWorkspace } from "./usePersonalHistory";
import { useProduction } from "./ProductionProvider";
import { useProductionFamilyDocuments, useProductionTaskKnowledgeSummary, useProductionTaskKnowledgeMemory } from "./TaskKnowledgeDomains";
import { useProductionPhotoInputDomains } from "./PhotoInputDomains";
import { useProductionContactDomain, useProductionSettingsDomains } from "./SettingsDomains";

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

/** Uses the same scoped projections as the visible route, without starting extra reads. */
export function ProductionStartupReadiness() {
  const pathname = usePathname(), params = useGlobalSearchParams<{ tab?: string | string[]; category?: string | string[]; section?: string | string[]; view?: string | string[]; taskId?: string | string[]; recordId?: string | string[]; record?: string | string[] }>();
  const visibleSection = useProductionVisibleSettingsSection();
  const { scopeKey, chatState, chatController, agentModel, agentActions, agentPending, readAgentPending } = useProduction();
  const recoveringDecision = !!agentModel?.pendingDecision;
  const care = useCareWorkspace(), profile = useProfileWorkspace(), tasks = useTasksWorkspace(), growth = useGrowthWorkspace();
  const memoryOwner = useProductionTaskKnowledgeMemory(), personalHistory = usePersonalHistoryWorkspace();
  const memory = useMemoryReferenceWorkspace(), documents = useProductionFamilyDocuments(), summary = useProductionTaskKnowledgeSummary();
  const photos = useProductionPhotoInputDomains(), { family, modelSettings, push, telegram, preferences } = useProductionSettingsDomains(), contact = useProductionContactDomain();
  const currentProfile = profile?.scopeKey === scopeKey ? profile.model : null;
  const currentSummary = summary?.model.scopeKey === scopeKey ? summary.model : null;
  const currentCare = care?.scopeKey === scopeKey ? care.model : null, currentTasks = tasks?.scopeKey === scopeKey ? tasks.model : null;
  const routeParams = { tab: first(params.tab), category: first(params.category), section: pathname === "/settings" ? visibleSection : first(params.section), view: first(params.view),
    taskId: first(params.taskId), recordId: typeof params.recordId === "string" ? params.recordId : typeof params.record === "string" ? params.record : undefined };
  const retries: Record<string, (() => void) | undefined> = {
    profile: profile?.actions.refresh,
    care: care ? () => care.actions.search(care.model.list.activeQuery, care.model.list.activeKind) : undefined,
    tasks: tasks?.recovery.reloadCurrent, growth: growth?.actions.refresh,
    taskDetail: routeParams.taskId && tasks ? () => tasks.actions.selectTask(routeParams.taskId!) : undefined,
    careDetail: routeParams.recordId && care ? () => care.actions.openRecord(routeParams.recordId!) : undefined,
    chat: () => { void chatController.reloadMessages(); }, agentPending: recoveringDecision ? agentActions.refresh : readAgentPending, memory: memoryOwner?.refresh,
    documents: documents?.refresh, summary: summary?.actions.refresh,
    conversations: personalHistory ? () => personalHistory.actions.searchHistory(personalHistory.history.data?.query ?? "") : undefined,
    notifications: personalHistory?.actions.loadNotifications,
    photos: photos?.photos.actions.refresh, sources: photos?.sources.actions.refresh,
    family: family.actions.refresh, contact: contact.actions.refresh, model: modelSettings.actions.refresh,
    push: push.actions.refresh, telegram: telegram.actions.refresh, preferences: preferences.refresh,
  };
  useProductionStartupReadiness(routeStartupReadiness(pathname, routeParams, {
    care: readState(care?.scopeKey === scopeKey ? care.model.list.state : undefined),
    careDetail: !currentCare ? "loading" : currentCare.access === "lost" || !currentCare.online ? "error" : targetStartupReadiness(routeParams.recordId, currentCare.detail?.record.id, currentCare.detailRead),
    profile: !currentProfile ? "loading" : currentProfile.needsRefresh ? "error" : currentProfile.reading ? "loading" : currentProfile.current ? "ready" : "error",
    tasks: readState(tasks?.scopeKey === scopeKey ? tasks.model.access === "lost" ? "error" : tasks.model.readState : undefined),
    taskDetail: !currentTasks ? "loading" : currentTasks.access === "lost" || !currentTasks.online ? "error" : targetStartupReadiness(routeParams.taskId, currentTasks.selected?.id, currentTasks.detailRead),
    growth: readState(growth?.scopeKey === scopeKey ? growth.model.access === "lost" ? "error" : growth.model.load : undefined),
    chat: chatState.error ? "error" : chatState.loading || !chatState.loadedAt ? "loading" : "ready",
    // ProductionOwner resets this owner before publishing the new child scope.
    // Recovery deliberately blocks discovery; its original-run GET is the visible read.
    // Do not mark the unread discovery page as loaded or let it strand the curtain.
    agentPending: recoveringDecision ? readState(agentModel.readState)
      : agentPending?.state === "denied" ? "error" : agentPending?.hasSnapshot ? "ready" : readState(agentPending?.state),
    memory: readState(memory?.scopeKey === scopeKey ? memory.model.access === "revoked" ? "error" : memory.model.longTerm.state : undefined),
    documents: readState(documents?.readState),
    conversations: personalHistory?.scopeKey !== scopeKey ? "loading" : personalHistory?.access === "revoked" || !personalHistory?.online ? "error"
      : personalHistory.history.state === "unavailable" ? "loading" : readState(personalHistory.history.state),
    notifications: personalHistory?.scopeKey !== scopeKey ? "loading" : personalHistory?.access === "revoked" || !personalHistory?.online ? "error"
      : personalHistory.notifications.state === "unavailable" ? "loading" : readState(personalHistory.notifications.state),
    summary: !currentSummary ? "loading" : currentSummary.readFailed || currentSummary.access === "lost" ? "error" : currentSummary.page ? "ready" : "loading",
    photos: Platform.OS !== "web" ? "ready" : readState(photos?.scopeKey === scopeKey ? photos.photos.model.load : undefined),
    sources: Platform.OS !== "web" ? "ready" : readState(photos?.scopeKey === scopeKey ? photos.sources.model.load : undefined),
    family: family.readState,
    contact: readState(contact.model.load),
    model: modelSettings.model.busy === "read" ? "loading" : modelSettings.model.snapshot ? "ready" : modelSettings.model.notice ? "error" : "loading",
    push: readState(push.model.readState), telegram: readState(telegram.model.readState),
    preferences: preferences.preferences ? "ready" : !preferences.busy && preferences.notice ? "error" : "loading",
  }, !!scopeKey, true), (additional = []) => {
    // Retry only the current shell and route through their existing guarded owners.
    for (const name of new Set([...routeStartupRequirements(pathname, routeParams, !!scopeKey, true), ...additional])) retries[name]?.();
  });
  return null;
}
