import { z } from 'zod';
import { pushDeliverySchema } from '../../../src/shared/web-push.ts';

export const adminDemoConfigSchema = z.object({ enabled: z.boolean() });
const demoReasonSchema = z.union([pushDeliverySchema.shape.reason,
  z.enum(['foreground_chat', 'awaiting_presence', 'chat_consent_disabled', 'quiet_hours', 'message_unavailable', 'proactive_disabled', 'task_unavailable'])]);
export const adminDemoReceiptSchema = z.object({
  opId: z.uuid(), messageId: z.string().min(1), text: z.string(),
  deliveries: z.array(z.object({ id: pushDeliverySchema.shape.id, status: pushDeliverySchema.shape.status, reason: demoReasonSchema })),
});
export type AdminDemoReceipt = z.infer<typeof adminDemoReceiptSchema>;
export interface AdminDemoState {
  status: 'unread' | 'loading' | 'ready' | 'error'; enabled: boolean; busy: boolean;
  pending: string | null; recoveryStored: boolean; receipt: AdminDemoReceipt | null; notice: string | null;
}
export const emptyDemo = (): AdminDemoState => ({ status: 'unread', enabled: false, busy: false, pending: null, recoveryStored: false, receipt: null, notice: null });
export type AdminDemoStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const demoPendingKey = (baseUrl: string, userId: string) => 'yuyoufang:admin-proactive-demo:' + encodeURIComponent(baseUrl) + ':' + encodeURIComponent(userId);
export function browserDemoStorage(): AdminDemoStorage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}
export function storedDemoPending(storage: AdminDemoStorage | null, baseUrl: string, userId: string): string | null {
  try { const value = storage?.getItem(demoPendingKey(baseUrl, userId)); return z.uuid().safeParse(value).success ? value! : null; }
  catch { return null; }
}
// Only known settled outcomes release the operation; future statuses remain recoverable.
export const demoSettled = (receipt: AdminDemoReceipt) => receipt.deliveries.every(item =>
  ['accepted', 'rejected', 'stopped'].includes(item.status));
export const demoDeliveryLabel = (status: string) => ({
  queued: '已排隊，尚未確認交送', sending: '正在交送', unknown: '結果未知', accepted: '推播服務已接受',
  rejected: '推播服務已拒絕', stopped: '交送已停止',
} as Record<string, string>)[status] ?? '未識別狀態，待核對';
export const demoReasonLabel = (reason: string) => ({
  subscription_expired: '通知綁定已過期', provider_rejected: '推播服務拒絕', rate_limited: '達到交送頻率限制',
  transport_unknown: '傳輸結果未知', revoked: '通知綁定已撤銷', worker_paused: '通知工作已暫停',
  configuration_unavailable: '通知配置未就緒', request_invalid: '通知請求無效', worker_interrupted: '通知工作中斷',
  local_preview_not_sent: '僅本機預覽，未發送',
  foreground_chat: '此手機正在前台查看原聊天', awaiting_presence: '正在核對此手機是否仍在聊天頁',
  chat_consent_disabled: '此手機未開啟聊天通知', quiet_hours: '目前為安靜時段，等候可發送時間',
  message_unavailable: '原聊天訊息已不可用', proactive_disabled: '主動助手已關閉', task_unavailable: '原待辦已不可用',
} as Record<string, string>)[reason] ?? reason;
