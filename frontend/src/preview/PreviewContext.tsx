import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "expo-router";
import { createPreviewModel, type PreviewScenario } from "./fixture";
import type { HomeActions, HomeDestination, HomeViewModel } from "../view-model";

type PreviewContextValue = {
  model: HomeViewModel;
  scenario: PreviewScenario;
  setScenario: (scenario: PreviewScenario) => void;
  actions: HomeActions;
  notice: string | null;
  dismissNotice: () => void;
  chatDraft: string;
  setChatDraft: (value: string) => void;
};

const PreviewContext = createContext<PreviewContextValue | null>(null);

const routes: Record<HomeDestination, "/chat" | "/care" | "/profile" | "/family" | "/memory"> = {
  chat: "/chat", care: "/care", profile: "/profile", family: "/family", memory: "/memory",
};

export function PreviewProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [scenario, setScenarioState] = useState<PreviewScenario>("normal");
  const [selectedChildId, setSelectedChildId] = useState("preview-child-1");
  const [notice, setNotice] = useState<string | null>(null);
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);

  const model = createPreviewModel(scenario, selectedChildId);
  const draftKey = model.selectedChildId ?? "no-child";
  const actions: HomeActions = {
    selectChild(id) {
      setSelectedChildId(id);
      setNotice("已切換合成孩子；正式版須先隔離上一位孩子的可見資料，再讀取新孩子的授權資料。");
    },
    refresh() {
      setScenarioState("loading");
      setNotice("正在模擬重新讀取；沒有向 Server 發出請求。");
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        setScenarioState("normal");
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
    open(destination) { router.push(routes[destination]); },
  };

  function setScenario(next: PreviewScenario) {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    setScenarioState(next);
    setNotice(null);
  }

  return <PreviewContext.Provider value={{
    model, scenario, setScenario, actions, notice, dismissNotice: () => setNotice(null),
    chatDraft: chatDrafts[draftKey] ?? "",
    setChatDraft: value => setChatDrafts(previous => ({ ...previous, [draftKey]: value })),
  }}>{children}</PreviewContext.Provider>;
}

export function usePreview() {
  const value = useContext(PreviewContext);
  if (!value) throw new Error("PreviewProvider is required for Web preview pages");
  return value;
}
