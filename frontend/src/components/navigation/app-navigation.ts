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
  family: { href: "/family", label: "家庭協調", short: "家庭", icon: "account-group-outline" },
  memory: { href: "/memory", label: "記憶與參考", short: "記憶", icon: "book-open-variant" },
  settings: { href: "/settings", label: "設定", short: "設定", icon: "cog-outline" },
  guide: { href: "/guide", label: "使用引導", short: "說明", icon: "compass-outline" },
  more: { href: "/more", label: "全部功能", short: "全部", icon: "dots-horizontal" },
  history: { href: "/history", label: "歷史", short: "歷史", icon: "history" },
} as const satisfies Record<NavigationKey, NavigationItem>;

export const desktopNavigationGroups = [
  { label: "照顧工作台", keys: ["home", "tasks", "growth", "care"] },
  { label: "孩子與資料", keys: ["summary", "profile", "photos", "memory", "sources", "history"] },
  { label: "協作與支援", keys: ["family", "contact", "guide", "more"] },
] as const;

/** The fifth mobile destination is visible, not hidden behind a directional gesture. */
export function isMoreNavigationPath(pathname: string) {
  return Object.entries(navigationItems).some(([key, item]) =>
    !["home", "chat", "tasks", "growth"].includes(key) && item.href === pathname);
}

// Catalogue labels derive from navigationItems so the same destination has one visible name.
export const moreNavigationGroups = [
  { title: "常用", detail: "日常照顧、助手與行動安排", items: [
    { key: "home", detail: "今日重點與待辦摘要" },
    { key: "chat", detail: "與助手對話、交代需要" },
    { key: "tasks", detail: "待辦、預約與完成記錄" },
    { key: "growth", detail: "關注鏈與準備單" },
    { key: "care", detail: "照顧記錄與核對" },
  ] },
  { title: "照顧資料", detail: "原始資料、概況與成長檔案", items: [
    { key: "history", detail: "按分類搜尋過往安排與資料" },
    { key: "summary", detail: "孩子概況、照顧摘要與成長檔案" },
    { key: "photos", detail: "回看照片、語音、影片與文件原檔" },
    { key: "profile", detail: "查看及更正孩子的基本資料" },
  ] },
  { title: "助手與家庭", detail: "對話背景、家庭協作與聯絡安排", items: [
    { key: "memory", detail: "查閱對話脈絡、記憶及來源" },
    { key: "family", detail: "家庭協作尚未開放；查看目前可用的聯絡設定" },
    { key: "contact", detail: "管理聯絡渠道及授權範圍" },
  ] },
  { title: "設定與協助", detail: "本人偏好、私人來源及使用說明", items: [
    { key: "settings", detail: "偏好與資料管理" },
    { key: "sources", detail: "管理提供給助手的私人來源" },
    { key: "guide", detail: "查看使用引導" },
  ] },
] as const;

/** Search only public navigation metadata, never private family content. */
export function searchNavigationCatalogue(query: string) {
  const terms = query.trim().toLocaleLowerCase("zh-HK").split(/\s+/).filter(Boolean);
  return moreNavigationGroups.map(group => ({ ...group, items: group.items.filter(item => {
    const route = navigationItems[item.key];
    const text = `${group.title} ${route.label} ${route.short} ${item.detail}`.toLocaleLowerCase("zh-HK");
    return terms.every(term => text.includes(term));
  }) })).filter(group => group.items.length > 0);
}
