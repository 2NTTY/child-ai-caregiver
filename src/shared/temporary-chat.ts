import { z } from "zod";

export const TEMPORARY_CHAT_LIMITS = {
  idleTtlMs: 15 * 60 * 1000,
  maxLifetimeMs: 60 * 60 * 1000,
  maxMessages: 40,
  maxMessageCharacters: 4000,
  maxActiveSessionsPerUser: 3,
  maxTotalSessions: 500,
  revokedTombstoneTtlMs: 24 * 60 * 60 * 1000,
  usageScopeChildId: "00000000-0000-0000-0000-000000000000",
} as const;

export const TEMPORARY_CHAT_COPY = {
  title: "臨時聊天",
  entryLabel: "臨時聊天",
  entryAccessibilityLabel: "開啟獨立空白臨時聊天",
  badgeLabel: "空白隔離 · 退出即清除",
  exitButtonLabel: "結束並清除",
  restartButtonLabel: "開啟新臨時聊天",
  retryCloseButtonLabel: "重試遠端清除",
  emptyTitle: "獨立空白臨時聊天",
  emptyDescription:
    "不載入私人記憶、孩子資料、主聊天歷史或任務，亦不會回寫任何記錄、待確認卡片或摘要；僅使用公共資料庫與公共搜索回答。",
  serviceControlNotice:
    "臨時聊天仍須登入帳戶並受每日服務用量上限約束，且不啟用助手自動授權或資料保存流程。",
  thirdPartyBoundaryNotice:
    "控制範圍說明：退出清除僅涵蓋本機與本項目應用伺服器內的會話內容、上下文與暫存；外部模型及搜索供應商依現行服務條款之傳輸與日誌保留政策不受本項目同步刪除保證。失聯後伺服器最遲於閒置 15 分鐘或開立滿 60 分鐘自動清除。",
  localAndRemoteClearedNotice:
    "已清除本機與應用伺服器上此臨時會話的內容及上下文；重新進入會開啟全新的空白會話。",
  localClearedRemoteConfirmingNotice:
    "本機臨時對話已立即清除，正在確認伺服器清除結果…",
  localClearedRemotePendingNotice:
    "本機臨時對話已立即清除，但尚未收到伺服器確認清除（不可視作遠端已確認刪除）；恢復連線後會自動重送清除通知，且伺服器最遲於閒置 15 分鐘或滿 60 分鐘後自動失效並清除。",
  sessionExpiredNotice:
    "此臨時會話已失效或已清除，無法續接；請開啟全新的空白臨時聊天。",
  inputPlaceholder: "在空白臨時聊天提問公共育兒知識…",
} as const;

export type TemporaryChatCloseReason =
  | "user_exit"
  | "sign_out"
  | "client_reset"
  | "page_unload";

export interface TemporaryChatCitation {
  id: string;
  title: string;
  publisher: string;
  url: string;
  classification: "official_guidance" | "recent_information" | "public_information";
  sourceDate: string | null;
  checkedAt: string | null;
  excerpt: string;
  acquisition: "library" | "live";
}

export type TemporaryChatHelpCardId = "emergency-hk-v1" | "medical-consult-hk-v1";

export interface TemporaryChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
  createdAt: string;
  citations?: TemporaryChatCitation[];
  helpCards?: TemporaryChatHelpCardId[];
}

export interface TemporaryChatSessionMeta {
  sessionId: string;
  generation: number;
  createdAt: string;
  lastActivityAt: string;
  idleExpiresAt: string;
  hardExpiresAt: string;
  idleTtlMs: number;
  maxLifetimeMs: number;
}

export interface TemporaryChatCloseReceipt {
  sessionId: string;
  status: "cleared" | "already_cleared";
  clearedAt: string;
  scope: "application_controlled_only";
  cancelledInFlight: boolean;
  generation: number;
}

export const temporaryChatCreateSchema = z.object({}).strict();

export const temporaryChatSendSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1)
      .max(TEMPORARY_CHAT_LIMITS.maxMessageCharacters),
    generation: z.number().int().min(1),
  })
  .strict();

export const temporaryChatCloseSchema = z
  .object({
    generation: z.number().int().min(1).optional(),
    reason: z
      .enum(["user_exit", "sign_out", "client_reset", "page_unload"])
      .optional(),
  })
  .strict();

export interface TemporaryChatCreateResponse {
  session: TemporaryChatSessionMeta;
  messages: TemporaryChatMessage[];
}

export interface TemporaryChatSendResponse {
  session: TemporaryChatSessionMeta;
  userMessage: TemporaryChatMessage;
  modelMessage: TemporaryChatMessage;
}

export interface TemporaryChatCloseResponse {
  receipt: TemporaryChatCloseReceipt;
}
