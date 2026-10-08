import { z } from "zod";

export const SERVICE_POLICY_VERSION = "2026-10-08";
export const SERVICE_DATA_NOTICE = "資料保存在本服務；使用 AI 時，獲授權的文字或照片會交由 Google 或你選用的模型供應商處理。私人來源只在本人範圍使用，不加入公共知識庫。通知及分享仍需另外授權。你可下載本人資料、刪除孩子或退出帳戶；備份按實際保留政策到期清除，恢復前會重新套用刪除紀錄。";
export const accountAcknowledgementSchema = z.object({ policyVersion: z.literal(SERVICE_POLICY_VERSION), accepted: z.literal(true), operationId: z.uuid() }).strict();
export const accountDeletionSchema = z.object({ operationId: z.uuid(), confirmation: z.literal("永久刪除我的帳戶"), password: z.string().min(1).max(128) }).strict();
export interface AccountServiceStatus {
  enabled: boolean;
  registration: "invite" | "trial";
  mailConfigured: boolean;
  policyVersion: string;
  notice: string;
  user: null | { id: string; emailVerified: boolean; acknowledged: boolean; acknowledgementVersion: string | null };
}

export const accountErasePrepareSchema = z.object({ operationId: z.uuid() }).strict();
export const accountEraseExecuteSchema = accountDeletionSchema.extend({ receiptToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
export interface AccountEraseReceipt { operationId: string; state: "prepared" | "completed"; attachmentsPending: boolean; }
export interface AccountExportPage { section: string; items: unknown[]; nextCursor: string | null; complete: boolean; scopeVersion: string; notices: string[]; }
