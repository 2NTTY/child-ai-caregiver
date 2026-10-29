import type { AppIconName } from "../AppIcon";
import type { HomeDestination } from "../../view-model";

export type AppPath = "/" | `/${HomeDestination}` | "/more" | "/history";
export type NavigationItem = { href: AppPath; label: string; short: string; icon: AppIconName };
type NavigationKey = "home" | HomeDestination | "more" | "history";

// Shared presentation metadata; destination owners keep navigation and permissions.
export const navigationItems = {
  home: { href: "/", label: "今日", short: "今日", icon: "home-outline" },
  chat: { href: "/chat", label: "助手", short: "助手", icon: "message-text-outline" },
  care: { href: "/care", label: "核對", short: "核對", icon: "notebook-outline" },
  photos: { href: "/photos", label: "附件回看", short: "附件", icon: "paperclip" },
  sources: { href: "/sources", label: "私人來源", short: "來源", icon: "link-variant" },
  tasks: { href: "/tasks", label: "待辦與預約", short: "待辦", icon: "clipboard-check-outline" },
  growth: { href: "/growth", label: "關注鏈與準備單", short: "關注", icon: "concern-outline" },
  summary: { href: "/summary", label: "概況", short: "概況", icon: "overview-outline" },
  contact: { href: "/contact", label: "聯絡授權", short: "聯絡", icon: "bell-outline" },
  profile: { href: "/profile", label: "子女檔案", short: "檔案", icon: "account-child-outline" },
  family: { href: "/family", label: "家庭協作狀態", short: "家庭", icon: "account-group-outline" },
  memory: { href: "/memory", label: "記憶與參考", short: "記憶", icon: "book-open-variant" },
  settings: { href: "/settings", label: "設定", short: "設定", icon: "cog-outline" },
  guide: { href: "/guide", label: "使用引導", short: "說明", icon: "compass-outline" },
  more: { href: "/more", label: "全部功能", short: "全部功能", icon: "dots-horizontal" },
  history: { href: "/history", label: "歷史", short: "歷史", icon: "history" },
} as const satisfies Record<NavigationKey, NavigationItem>;

// One purpose-led chapter map for the shell and the full mobile directory.
export const handbookNavigationChapters = [
  { label: "現在照顧", detail: "提問、安排與接續跟進", keys: ["home", "chat", "tasks", "growth"] },
  { label: "孩子手冊", detail: "目前概況、已保存記錄與過往版本", keys: ["summary", "care", "history", "profile"] },
  { label: "資料與原文", detail: "閱讀參考、回看原檔與核對來源", keys: ["memory", "photos", "sources"] },
  { label: "本人控制", detail: "本人設定、聯絡授權與使用說明", keys: ["settings", "contact", "family", "guide", "more"] },
] as const;
const destinationNotes: Record<Exclude<NavigationKey, "more">, string> = {
  home: "現在需要接續的安排與關注", chat: "直接問一個問題；送出前仍可修改", tasks: "待辦、預約與完成記錄", growth: "持續關注與到診準備",
  summary: "孩子概況與已整理的成長文件", care: "核對照顧記錄與當時原話", history: "按分類找回過往內容", profile: "查看及更正孩子的基本資料",
  memory: "對話脈絡、已確認記憶與參考", photos: "回看照片、語音、影片及文件原檔", sources: "管理你提供的私人來源",
  settings: "帳戶、偏好、模型與資料管理", contact: "本人接收渠道及聯絡授權", family: "家庭協作尚未開放；查看目前入口", guide: "了解如何開始及資料界線",
};
export const moreNavigationGroups = handbookNavigationChapters.map(group => ({
  title: group.label, detail: group.detail,
  items: group.keys.flatMap(key => key === "more" ? [] : [{ key, detail: destinationNotes[key] }]),
}));

export function moreCatalogueColumns(availableWidth: number): 1 | 2 | 3 {
  if (availableWidth >= 900) return 3;
  if (availableWidth >= 432) return 2;
  return 1;
}
