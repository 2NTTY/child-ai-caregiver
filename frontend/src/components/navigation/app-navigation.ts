import type { AppIconName } from "../AppIcon";
import type { HomeDestination } from "../../view-model";

export type AppPath = "/" | `/${HomeDestination}` | "/more" | "/history";
export type NavigationItem = { href: AppPath; label: string; short: string; icon: AppIconName };
type NavigationKey = "home" | HomeDestination | "more" | "history";

// Shared presentation metadata; destination owners keep navigation and permissions.
export const navigationItems = {
  home: { href: "/", label: "今日", short: "今日", icon: "home-outline" },
  chat: { href: "/chat", label: "助手", short: "助手", icon: "message-text-outline" },
  care: { href: "/care", label: "記錄與核對", short: "記錄", icon: "notebook-outline" },
  photos: { href: "/photos", label: "照片與記錄", short: "照片", icon: "image-outline" },
  sources: { href: "/sources", label: "私人來源", short: "來源", icon: "link-variant" },
  tasks: { href: "/tasks", label: "待辦與預約", short: "待辦", icon: "clipboard-check-outline" },
  growth: { href: "/growth", label: "成長與關注", short: "成長", icon: "chart-bar" },
  summary: { href: "/summary", label: "孩子概況與準備", short: "概況", icon: "clipboard-check-outline" },
  contact: { href: "/contact", label: "聯絡授權", short: "聯絡", icon: "bell-outline" },
  profile: { href: "/profile", label: "子女檔案", short: "孩子", icon: "account-child-outline" },
  family: { href: "/family", label: "家庭協調", short: "家庭", icon: "account-group-outline" },
  memory: { href: "/memory", label: "記憶與參考", short: "記憶", icon: "book-open-variant" },
  settings: { href: "/settings", label: "設定", short: "設定", icon: "cog-outline" },
  guide: { href: "/guide", label: "使用引導", short: "說明", icon: "compass-outline" },
  more: { href: "/more", label: "更多功能", short: "更多", icon: "dots-horizontal" },
  history: { href: "/history", label: "歷史", short: "歷史", icon: "history" },
} as const satisfies Record<NavigationKey, NavigationItem>;

export const desktopNavigationGroups = [
  { label: "常用", keys: ["home"] },
  { label: "行動與成長", keys: ["tasks", "growth"] },
  { label: "照顧資料", keys: ["care", "summary", "history"] },
  { label: "資料管理", keys: ["profile", "memory", "more"] },
] as const;

export const moreNavigationGroups = [
  { title: "照顧資料", detail: "核對原始資料、查看孩子近況與準備單", items: [
    { key: "history", label: "分類歷史", detail: "按分類搜尋過往安排與資料" },
    { key: "summary", label: "孩子概況與準備", detail: "目前資料、待用準備單與使用後歸檔" },
    { key: "photos", label: "含照片記錄", detail: "篩選照片，查看原始附件" },
    { key: "profile", label: "子女檔案", detail: "查看及更正孩子的基本資料" },
  ] },
  { title: "助手與家庭", detail: "對話背景、家庭協作與聯絡安排", items: [
    { key: "memory", label: "記憶與參考", detail: "查閱對話脈絡、記憶及來源" },
    { key: "family", label: "家庭協調與成員", detail: "查看家庭成員、角色與分工" },
    { key: "contact", label: "聯絡授權", detail: "管理聯絡渠道及授權範圍" },
  ] },
  { title: "設定與協助", detail: "本人偏好、私人來源及使用說明", items: [
    { key: "settings", label: "設定", detail: "偏好、資料管理及使用引導" },
  ] },
] as const;

export function moreCatalogueColumns(availableWidth: number): 1 | 2 | 3 {
  if (availableWidth >= 900) return 3;
  if (availableWidth >= 432) return 2;
  return 1;
}
