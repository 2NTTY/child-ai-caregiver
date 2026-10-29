import type { AppIconName } from "../AppIcon";
import type { HomeDestination } from "../../view-model";

export type AppPath = "/" | `/${HomeDestination}` | "/more" | "/history";
export type NavigationItem = { href: AppPath; label: string; short: string; icon: AppIconName };
type NavigationKey = "home" | HomeDestination | "more" | "history";

// Shared presentation metadata; destination owners keep navigation and permissions.
export const navigationItems = {
  home: { href: "/", label: "今天", short: "今天", icon: "home-outline" },
  chat: { href: "/chat", label: "問助手", short: "問助手", icon: "message-text-outline" },
  care: { href: "/care", label: "記低", short: "記低", icon: "notebook-outline" },
  photos: { href: "/photos", label: "附件回看", short: "附件", icon: "paperclip" },
  sources: { href: "/sources", label: "私人來源", short: "來源", icon: "link-variant" },
  tasks: { href: "/tasks", label: "待辦與預約", short: "待辦", icon: "clipboard-check-outline" },
  growth: { href: "/growth", label: "關注鏈與準備單", short: "關注", icon: "concern-outline" },
  summary: { href: "/summary", label: "查閱", short: "查閱", icon: "overview-outline" },
  contact: { href: "/contact", label: "聯絡授權", short: "聯絡", icon: "bell-outline" },
  profile: { href: "/profile", label: "子女檔案", short: "檔案", icon: "account-child-outline" },
  family: { href: "/family", label: "家庭功能狀態", short: "家庭", icon: "account-group-outline" },
  memory: { href: "/memory", label: "記憶與參考", short: "記憶", icon: "book-open-variant" },
  settings: { href: "/settings", label: "我的", short: "我的", icon: "cog-outline" },
  guide: { href: "/guide", label: "使用引導", short: "說明", icon: "compass-outline" },
  more: { href: "/more", label: "全部功能", short: "更多", icon: "dots-horizontal" },
  history: { href: "/history", label: "歷史", short: "歷史", icon: "history" },
} as const satisfies Record<NavigationKey, NavigationItem>;
