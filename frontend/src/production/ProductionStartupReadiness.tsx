import { useGlobalSearchParams, usePathname } from "expo-router";
import { Platform } from "react-native";
import { useCareWorkspace } from "../workspaces/CareWorkspace";
import { useProfileWorkspace } from "../workspaces/ProfileWorkspace";
import { useTasksWorkspace } from "../workspaces/TasksWorkspace";
import { useGrowthWorkspace } from "../workspaces/GrowthWorkspace";
import { useMemoryReferenceWorkspace } from "../workspaces/MemoryReferenceWorkspace";
import { routeStartupReadiness, type StartupReadiness } from "../startup/dataReadiness";
import { useProductionStartupReadiness } from "./ProductionFirstScreenGate";
import { useProduction } from "./ProductionProvider";
import { useProductionFamilyDocuments, useProductionTaskKnowledgeSummary } from "./TaskKnowledgeDomains";
import { useProductionPhotoInputDomains } from "./PhotoInputDomains";
import { useProductionContactDomain, useProductionSettingsDomains } from "./SettingsDomains";

const readState = (value: string | undefined): StartupReadiness => value === undefined || ["loading", "loading_more", "idle", "unread"].includes(value) ? "loading"
  : ["ready", "available"].includes(value) ? "ready" : "error";
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

/** Uses the same scoped projections as the visible route, without starting extra reads. */
export function ProductionStartupReadiness() {
  const pathname = usePathname(), params = useGlobalSearchParams<{ tab?: string | string[]; category?: string | string[]; section?: string | string[] }>();
  const { scopeKey, chatState } = useProduction();
  const care = useCareWorkspace(), profile = useProfileWorkspace(), tasks = useTasksWorkspace(), growth = useGrowthWorkspace();
  const memory = useMemoryReferenceWorkspace(), documents = useProductionFamilyDocuments(), summary = useProductionTaskKnowledgeSummary();
  const photos = useProductionPhotoInputDomains(), { family, modelSettings, push, telegram } = useProductionSettingsDomains(), contact = useProductionContactDomain();
  const currentProfile = profile?.scopeKey === scopeKey ? profile.model : null;
  const currentSummary = summary?.model.scopeKey === scopeKey ? summary.model : null;
  useProductionStartupReadiness(routeStartupReadiness(pathname, { tab: first(params.tab), category: first(params.category), section: first(params.section) }, {
    care: readState(care?.scopeKey === scopeKey ? care.model.list.state : undefined),
    profile: !currentProfile ? "loading" : currentProfile.needsRefresh ? "error" : currentProfile.reading ? "loading" : currentProfile.current ? "ready" : "error",
    tasks: readState(tasks?.scopeKey === scopeKey ? tasks.model.access === "lost" ? "error" : tasks.model.readState : undefined),
    growth: readState(growth?.scopeKey === scopeKey ? growth.model.access === "lost" ? "error" : growth.model.load : undefined),
    chat: chatState.error ? "error" : chatState.loading || !chatState.loadedAt ? "loading" : "ready",
    memory: readState(memory?.scopeKey === scopeKey ? memory.model.access === "revoked" ? "error" : memory.model.longTerm.state : undefined),
    documents: readState(documents?.readState),
    summary: !currentSummary ? "loading" : currentSummary.readFailed || currentSummary.access === "lost" ? "error" : currentSummary.page ? "ready" : "loading",
    photos: Platform.OS !== "web" ? "ready" : readState(photos?.scopeKey === scopeKey ? photos.photos.model.load : undefined),
    sources: Platform.OS !== "web" ? "ready" : readState(photos?.scopeKey === scopeKey ? photos.sources.model.load : undefined),
    family: family.readState,
    contact: readState(contact.model.load),
    model: modelSettings.model.busy === "read" ? "loading" : modelSettings.model.snapshot ? "ready" : modelSettings.model.notice ? "error" : "loading",
    push: readState(push.model.readState), telegram: readState(telegram.model.readState),
  }));
  return null;
}
