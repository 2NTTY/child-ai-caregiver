import { navigationItems, type AppPath } from "../navigation/app-navigation";
export const workspaceGroups = [
  { key: "overview", title: "照顧總覽", home: "home", items: ["home", "summary"] },
  { key: "assistant", title: "育兒助手", home: "chat", items: ["chat", "memory", "sources"] },
  { key: "actions", title: "行動安排", home: "tasks", items: ["tasks", "growth"] },
  { key: "records", title: "資料與記錄", home: "care", items: ["care", "photos", "history"] },
  { key: "family", title: "孩子與家庭", home: "profile", items: ["profile", "family", "contact"] },
  { key: "tools", title: "工具與設定", home: "more", items: ["more", "settings", "guide"] },
] as const;
export function workspaceForPath(path: string) {
  return workspaceGroups.find(group => group.items.some(key => navigationItems[key].href === path)) ?? workspaceGroups[0];
}
export const workspaceDescriptions: Partial<Record<AppPath, string>> = {
  "/tasks": "把下一步排清楚。待辦、預約與提醒，放在同一個工作台。",
  "/growth": "由關注到行動：整理發展脈絡，準備下一次諮詢。",
  "/summary": "已確認的孩子資料、照顧摘要與成長檔案，一處回顧。",
  "/care": "先核對，再保存。保留照顧記錄的原文、時間及依據。",
  "/photos": "按孩子回看照片、錄音與文件；原檔及處理狀態清楚分開。",
  "/history": "按類別回看過往資料，接續原有安排。",
  "/memory": "讓助手使用的背景資料保持清楚、可查閱、可管理。",
  "/sources": "管理你提供的參考來源，不加入公共知識庫。",
  "/profile": "只記已知的資料。未知、約數與待核對內容如實保留。",
  "/family": "清楚看見家庭成員、孩子與各人的角色。",
  "/contact": "聯絡渠道與使用授權分開管理，由你決定範圍。",
  "/settings": "管理你的帳戶、助手、外觀與資料偏好。",
  "/guide": "按需要設定育伴港，了解資料、助手與確認流程。",
  "/more": "所有功能按工作整理，隨時回到你需要的地方。",
};
