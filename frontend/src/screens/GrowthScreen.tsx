import { parseGrowthRoute, serializeGrowthRoute } from "../navigation/route-state";
import { useScopedRouteState } from "../navigation/useScopedRouteState";
import { homeTargetHref } from "../home-target";
import { useEffect, useRef } from "react";
import { Redirect, useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { Text } from "react-native-paper";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useProduction } from "../production/ProductionProvider";
import { TaskKnowledgeGrowthCandidates, GrowthSuggestionSettings } from "../production/TaskKnowledgeGrowthCandidates";
import { useGrowthWorkspace } from "../workspaces/GrowthWorkspace";
import { useTasksWorkspace } from "../workspaces/TasksWorkspace";
import { usePreparationWorkspace } from "../workspaces/PreparationWorkspace";
import { GrowthView } from "../components/growth/GrowthView";
import { AppButton, SectionCard } from "../components/ui";
import { PageFrame } from "../components/PageFrame";

export function GrowthScreen() {
  const { model, actions, scopeKey, identityKey, owner } = useProduction(), workspace = useGrowthWorkspace(), tasks = useTasksWorkspace();
  const preparations = usePreparationWorkspace();
  const params = useLocalSearchParams();
  const requestedTab = params.tab;
  const parsed = parseGrowthRoute(params);
  const route = useScopedRouteState(scopeKey, "/growth", parsed, { ...parsed, concernId: null, documentId: null }, value => ({ pathname: "/growth", params: serializeGrowthRoute(value) }));
  const routeKey = JSON.stringify(params);
  const requested = Array.isArray(requestedTab) ? undefined : requestedTab;
  const tab = route.tab;
  const router = useRouter(), navigate = usePreviewNavigation(), pathname = usePathname();
  const current = useRef({ scopeKey, pathname, routeKey, mounted: true });
  current.current = { scopeKey, pathname, routeKey, mounted: true };
  useEffect(() => { current.current.mounted = true; return () => { current.current.mounted = false; }; }, []);
  function guarded(action: () => void, intent: "navigation" | "workspace" = "workspace") {
    navigate(() => {
      const live = current.current, snapshot = owner.getSnapshot();
      if (snapshot.scopeKey !== scopeKey || snapshot.identityKey !== identityKey) return;
      if (!live.mounted || live.scopeKey !== scopeKey || live.pathname !== pathname || live.routeKey !== routeKey) return;
      action();
    }, intent);
  }
  const requestedDocument = useRef("");
  useEffect(() => {
    if (pathname !== "/growth" || tab !== "preparation" || !preparations || owner.getSnapshot().scopeKey !== scopeKey || preparations.model.condition === "lost") return;
    const id = route.documentId, key = `${scopeKey}:${id ?? "list"}`;
    if (requestedDocument.current === key) return;
    if (id && !preparations.model.documents.some(document => document.id === id && document.status === "active")) return;
    requestedDocument.current = key;
    if (id) preparations.actions.selectDocument(id); else preparations.actions.closeDocument();
  }, [pathname, tab, scopeKey, route.documentId, preparations?.model.documents, preparations?.model.condition]);
  const result = useRef({ scopeKey, epoch: preparations?.model.epoch, archivedId: preparations?.model.justArchivedId, selectedId: preparations?.model.selected?.id });
  useEffect(() => {
    const previous = result.current;
    result.current = { scopeKey, epoch: preparations?.model.epoch, archivedId: preparations?.model.justArchivedId, selectedId: preparations?.model.selected?.id };
    if (pathname !== "/growth" || tab !== "preparation" || previous.scopeKey !== scopeKey
      || !preparations || owner.getSnapshot().scopeKey !== scopeKey || preparations.model.operation?.state !== "saved") return;
    const selected = preparations.model.selected;
    if (previous.epoch !== preparations.model.epoch && selected?.status === "active" && previous.selectedId !== selected.id) {
      requestedDocument.current = `${scopeKey}:${selected.id}`;
      router.replace({ pathname: "/growth", params: serializeGrowthRoute({ ...route, documentId: selected.id }) });
    } else if (preparations.model.justArchivedId && previous.archivedId !== preparations.model.justArchivedId && route.documentId === preparations.model.justArchivedId) {
      requestedDocument.current = `${scopeKey}:list`;
      router.replace({ pathname: "/growth", params: serializeGrowthRoute({ ...route, documentId: null }) });
    }
  }, [scopeKey, pathname, tab, preparations?.model.epoch, preparations?.model.justArchivedId, preparations?.model.selected, preparations?.model.operation?.state]);
  const child = model.children.find(item => item.id === model.selectedChildId);
  const openTask = (id: string) => guarded(() => router.push(homeTargetHref({ destination: "tasks", taskId: id })));
  if (pathname !== "/growth") return null;
  // Compatibility routes reuse the same dashboard owners; no data or operation is migrated.
  if (requested === "archive") return <Redirect href="/summary?tab=archive" />;
  if (!child || !workspace) return <PageFrame density="compact" title="關注"><SectionCard>
    <Text>{child ? "正在讀取關注…" : "先選擇孩子。"}</Text>
    <AppButton label="查看子女檔案" onPress={() => actions.open("profile")} />
  </SectionCard></PageFrame>;
  return <GrowthView key={workspace.scopeKey} model={workspace.model} actions={workspace.actions} tab={tab}
    selectedConcernId={route.concernId}
    selectedDocumentId={route.documentId}
    onDocumentChange={id => guarded(() => router.push({ pathname: "/growth", params: serializeGrowthRoute({ ...route, tab: "preparation", documentId: id }) }))}
    onConcernChange={id => guarded(() => router.push({ pathname: "/growth", params: serializeGrowthRoute({ ...route, concernId: id }) }))}
    onTabChange={next => { if (next !== tab) guarded(() => { preparations?.actions.closeDocument(); router.push({ pathname: "/growth", params: serializeGrowthRoute({ tab: next, concernId: null, documentId: null }) }); }, "workspace"); }}
    onTask={openTask}
    onRecord={id => guarded(() => router.push({ pathname: "/care", params: { tab: "records", ...(id ? { recordId: id } : {}) } }))}
    onReview={() => guarded(() => router.push({ pathname: "/history", params: { category: "review" } }))}
    onHistory={() => guarded(() => router.push("/history?category=growth"))}
    onChat={() => guarded(() => router.push("/chat"))}
    onPrepareQuestion={actions.prepareQuestion}
    onPreparationHistory={() => guarded(() => router.push({ pathname: "/history", params: { category: "preparations" } }))}
    managementTools={<GrowthSuggestionSettings model={workspace.model} actions={workspace.actions} />}
    previewTools={<TaskKnowledgeGrowthCandidates model={workspace.model} actions={workspace.actions} onTask={openTask} />} />;
}
