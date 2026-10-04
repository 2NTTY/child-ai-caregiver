import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "expo-router";
import { usePreviewNavigation } from "./PreviewNavigationGuard";
import { createPreviewModel, previewChecklist, type PreviewScenario } from "./fixture";
import type { GuideStatus, HomeActions, HomeChild, HomeDestination, HomeViewModel } from "../view-model";

type PreviewContextValue = {
  model: HomeViewModel;
  scenario: PreviewScenario;
  setScenario: (scenario: PreviewScenario) => void;
  actions: HomeActions;
  homeIntroductionPending: boolean;
  markHomeIntroductionPresented: () => void;
  notice: string | null;
  dismissNotice: () => void;
  chatDraft: string;
  setChatDraft: (value: string) => void;
  checkedPreviewItems: Record<string, boolean>;
  togglePreviewItem: (id: string) => void;
};

const PreviewContext = createContext<PreviewContextValue | null>(null);

const routes: Record<HomeDestination, "/chat" | "/care" | "/profile" | "/family" | "/memory" | "/settings" | "/guide" | "/tasks" | "/photos" | "/sources" | "/growth" | "/summary" | "/contact"> = {
  chat: "/chat", care: "/care", profile: "/profile", family: "/family", memory: "/memory", settings: "/settings", guide: "/guide", tasks: "/tasks", photos: "/photos", sources: "/sources", growth: "/growth", summary: "/summary", contact: "/contact",
};

export function PreviewProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const leave = usePreviewNavigation();
  const [scenario, setScenarioState] = useState<PreviewScenario>("normal");
  const [guideStatus, setGuideStatus] = useState<GuideStatus>("complete");
  const [selectedChildId, setSelectedChildId] = useState("preview-child-1");
  const [homeIntroductionPending, setHomeIntroductionPending] = useState(true);
  // The dashboard provider is the synthetic session boundary, not a route or child boundary.
  const markHomeIntroductionPresented = useCallback(() => setHomeIntroductionPending(false), []);
  const [notice, setNotice] = useState<string | null>(null);
  const [createdChildren, setCreatedChildren] = useState<HomeChild[]>([]);
  const [deletedChildren, setDeletedChildren] = useState<string[]>([]);
  const childSerial = useRef(0);
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const [checkedPreviewItems, setCheckedPreviewItems] = useState<Record<string, boolean>>({});
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);

  // Resolve visible children before deriving any child-scoped home/rail projection.
  const model = createPreviewModel(scenario, selectedChildId, guideStatus, { createdChildren, deletedChildIds: deletedChildren });
  const childrenInPreview = model.children;
  const draftKey = model.selectedChildId ?? "no-child";
  const actions: HomeActions = {
    selectChild(id) {
      if (id === model.selectedChildId) return;
      leave(() => { setSelectedChildId(id);
        setNotice("已切換合成孩子；正式版須先隔離上一位孩子的可見資料，再讀取新孩子的授權資料。"); }, "child");
    },
    refresh() {
      const restoreScenario = scenario === "loading" ? "normal" : scenario;
      setScenarioState("loading");
      setNotice("正在模擬重新讀取；沒有向 Server 發出請求。");
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        setScenarioState(restoreScenario);
        setNotice("合成預覽讀取完成；這不是 Server 確認。");
      }, 650);
    },
    reviewOperation() {
      setNotice(scenario === "unknown"
        ? "結果未知：正式操作須以原 opId 查核，不能自動重送。"
        : scenario === "needs_confirmation"
          ? "這仍是候選內容；正式版須開啟原記錄，核對後才可確認。"
          : "正式版須返回原操作並保留輸入；預覽沒有提交資料。");
    },
    open(destination) { leave(() => router.push(routes[destination])); },
    composeCare(kind) { leave(() => router.push({ pathname: "/care", params: { compose: kind } })); },
    prepareQuestion(question) {
      if (!model.selectedChildId) return;
      if (chatDrafts[draftKey]?.trim()) setNotice("保留你原本未發送的問題；可在對話頁核對後修改。");
      else setChatDrafts(previous => ({ ...previous, [draftKey]: question }));
      leave(() => router.push("/chat"));
    },
    createChildPreview(displayName) {
      const child: HomeChild = { id: `preview-new-child-${++childSerial.current}`, displayName,
        accessRole: "owner",
        ageLabel: "年齡未提供", regionLabel: "未提供", allergiesLabel: null, profileConfirmed: false };
      setCreatedChildren(previous => [...previous, child]); setSelectedChildId(child.id);
      setNotice("已模擬新增孩子，只留在本次預覽。尚未建立真家庭資料或確認檔案。");
    },
    deleteChildPreview(id) {
      if (!childrenInPreview.some(child => child.id === id && child.accessRole === "owner")) return;
      setDeletedChildren(previous => [...previous, id]);
      setCreatedChildren(previous => previous.filter(child => child.id !== id));
      const checklistIds = new Set(previewChecklist.filter(item => item.childId === id).map(item => item.id));
      setCheckedPreviewItems(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !checklistIds.has(key))));
      setChatDrafts(previous => { const next = { ...previous }; delete next[id]; return next; });
      setNotice("已模擬移除孩子及本頁關聯草稿。只影響合成預覽；沒有刪除真家庭資料。");
    },
    completeGuidePreview() {
      if (model.children.length === 0) return;
      setGuideStatus("complete");
      if (["first_login", "setup_incomplete"].includes(scenario)) setScenarioState("normal");
      setNotice("只在本地預覽標記引導已看過；正式完成狀態仍須由 Server 回傳。");
    },
  };

  function setScenario(next: PreviewScenario) {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    setScenarioState(next);
    setCreatedChildren([]); setDeletedChildren([]); setSelectedChildId("preview-child-1");
    if (next === "first_login") setGuideStatus("first_login");
    else if (next === "setup_incomplete" || next === "empty") setGuideStatus("incomplete");
    else if (next === "normal") setGuideStatus("complete");
    setNotice(null);
  }

  return <PreviewContext.Provider value={{
    model, scenario, setScenario, actions, homeIntroductionPending, markHomeIntroductionPresented,
    notice, dismissNotice: () => setNotice(null),
    chatDraft: chatDrafts[draftKey] ?? "",
    setChatDraft: value => setChatDrafts(previous => ({ ...previous, [draftKey]: value })),
    checkedPreviewItems,
    togglePreviewItem: id => {
      setCheckedPreviewItems(previous => ({ ...previous, [id]: !previous[id] }));
      setNotice("只在這個合成預覽標記；沒有保存正式任務，也沒有通知家庭成員。");
    },
  }}>{children}</PreviewContext.Provider>;
}

export function usePreview() {
  const value = useContext(PreviewContext);
  if (!value) throw new Error("PreviewProvider is required for Web preview pages");
  return value;
}
