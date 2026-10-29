import { navigationItems } from "../navigation/app-navigation";
export const workspaceGroups = [
  { key: "today", title: "今天", home: "home", items: ["home", "tasks", "growth"] },
  { key: "assistant", title: "問助手", home: "chat", items: ["chat"] },
  { key: "capture", title: "記低", home: "care", items: ["care"] },
  { key: "reading", title: "查閱", home: "summary", items: ["summary", "history", "memory", "sources", "photos"] },
  { key: "personal", title: "我的", home: "settings", items: ["settings", "profile", "contact", "family", "guide", "more"] },
] as const;
export function workspaceForPath(path: string) {
  return workspaceGroups.find(group => group.items.some(key => navigationItems[key].href === path)) ?? workspaceGroups[0];
}
// Mobile exposes five explicit destinations while retaining location for deeper routes.
export function mobileNavigationKeyForPath(path: string) {
  return workspaceForPath(path).home;
}

// Purpose titles name primary navigation; these labels name its actual pages.
export function workspaceDestination(key: keyof typeof navigationItems) {
  return { ...navigationItems[key], label: key === "summary" ? "概況與報告" : navigationItems[key].label };
}
const purposeDetails = {
  today: "查看當下事項，接續待辦與關注",
  assistant: "提問、閱讀回覆與核對來源",
  capture: "記低照顧情況，再核對及更正",
  reading: "找回概況、記錄、記憶及原始資料",
  personal: "管理本人設定、子女檔案與授權",
};
const destinationDetails: Record<keyof typeof navigationItems, string> = {
  home: "今日重點與待辦摘要", chat: "與助手對話、交代需要", care: "直接記錄、核對候選及查看已保存內容",
  tasks: "待辦、預約與完成記錄", growth: "接續關注鏈與到診準備單", summary: "孩子概況、照顧摘要與成長報告",
  history: "按分類搜尋過往安排與資料", memory: "查閱事實、工作脈絡與參考資料", sources: "管理提供給助手的私人來源",
  photos: "回看照片、語音、影片與文件原檔", settings: "通知偏好、模型與資料管理", profile: "查看及更正孩子的基本資料",
  contact: "管理聯絡渠道及授權範圍", family: "查看家庭功能狀態及可用設定", guide: "按需要閱讀使用引導", more: "按目的尋找全部功能",
};
export const workspaceCatalogue = workspaceGroups.map(group => ({
  title: group.title, detail: purposeDetails[group.key],
  items: group.items.filter(key => key !== "more").map(key => ({ key, detail: destinationDetails[key] })),
}));
