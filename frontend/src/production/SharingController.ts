import { SharingApiError, type SharingApi } from "../../../src/client/sharing-api.ts";
import { sharingCommandSchema, type SharedSpaceView, type SharedMemberView, type SharedGrantView, type SharedInviteView, type SharedPage, type SharingCommand, type SharingOperation } from "../../../src/shared/sharing-control.ts";

type Pending = { command: SharingCommand; checked: boolean; unknown: boolean };
export interface SharingState {
  identityKey: string | null; userId: string | null; online: boolean; loaded: boolean; busy: "read" | "write" | "check" | null;
  spaces: SharedPage<SharedSpaceView>; selected: SharedSpaceView | null;
  members: SharedPage<SharedMemberView>; shares: SharedPage<SharedGrantView>; invitations: SharedPage<SharedInviteView>;
  pending: Pending | null; invitationToken: string | null; receipt: SharingOperation | null; notice: string | null;
}
const page = <T>(): SharedPage<T> => ({ items: [], nextCursor: null });
const noEffectRejections = new Set(["invalid_input", "version_conflict", "read_only", "space_manager_required", "invitation_expired",
  "invitation_recipient", "invitation_revoked", "invitation_already_used", "already_member", "transfer_target", "space_transfer_or_dissolve_required"]);
const initial = (userId: string | null, identityKey: string | null, online: boolean): SharingState => ({ userId, identityKey, online, loaded: false, busy: null,
  spaces: page(), selected: null, members: page(), shares: page(), invitations: page(), pending: null, invitationToken: null, receipt: null, notice: null });
const errorText = (error: unknown) => {
  const code = error instanceof SharingApiError ? error.code : "";
  const messages: Record<string, string> = {
    invalid_input: "請核對名稱、電郵、邀請代碼及所選模組。", version_conflict: "家庭已被更新，請重新讀取並核對目前範圍後再操作。",
    space_version_conflict: "家庭版本已改變，請重新讀取再核對。", read_only: "你在這個家庭只有閱讀權限。", forbidden: "目前身份沒有這項管理權限。",
    space_access_denied: "你已不能存取這個家庭，請重新讀取家庭列表。", not_found: "家庭或目標已不存在，請重新讀取。",
    invitation_invalid: "邀請代碼無效或已失效，請向邀請者索取目前有效代碼。", invitation_expired: "邀請已過期，請邀請者重新發出。",
    invitation_email_mismatch: "邀請電郵與目前已驗證身份不符，請核對帳戶及邀請地址。", email_not_verified: "請先完成本人電郵驗證。",
    invitation_recipient: "邀請電郵與目前已驗證身份不符，請核對帳戶及邀請地址。", invitation_revoked: "這個邀請已被撤銷，請向管理員索取有效代碼。",
    invitation_already_used: "這個邀請已被使用，請重新讀取目前邀請狀態。", already_member: "你已是這個家庭的成員，請重新讀取家庭列表。",
    space_transfer_required: "管理員須先完成管理權轉交或解散家庭，才能退出。", transfer_not_pending: "目前沒有可由你接受的管理權轉交，請重新讀取。",
    space_transfer_or_dissolve_required: "管理員須先完成管理權轉交或解散家庭，才能退出或移除管理員。", transfer_target: "管理權轉交的指定成員不符，請重新讀取並核對對象。",
    space_manager_required: "只有目前管理員可以執行這項操作。", space_inactive: "這個家庭已停止使用，請重新讀取列表。",
    sharing_scope_changed: "家庭分享範圍或版本已改變。請重新讀取家庭列表及目前資料。", invalid_cursor: "列表續讀位置已失效，請重新讀取第一頁。",
    unauthorized: "請重新確認登入狀態。", identity_changed: "登入身份已改變，舊回應不會套用。", session_changed: "登入身份已改變，請重新登入。",
    operation_conflict: "原操作內容不符，請查核原操作，不要建立替代操作。", sharing_response_invalid: "未能核對 Server 回應，請重新讀取；已提交操作須沿原操作查回。",
  };
  return Object.hasOwn(messages, code) ? messages[code] : "暫未能確認結果，請檢查連線後重新讀取。";
};
type Ticket = { epoch: number; userId: string; controller: AbortController };

/** One owner/session scope retains original commands across navigation, only in memory. */
export class SharingController {
  private state = initial(null, null, false); private epoch = 0; private active: AbortController | null = null;
  private listeners = new Set<() => void>();
  private readonly api: SharingApi;
  constructor(api: SharingApi) { this.api = api; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<SharingState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  syncContext(userId: string | null, identityKey: string | null, online: boolean) {
    if (this.state.userId !== userId || this.state.identityKey !== identityKey) {
      this.active?.abort(); this.active = null; this.epoch++; this.state = initial(userId, identityKey, online); this.update({});
    } else if (online !== this.state.online) {
      if (!online) { this.active?.abort(); this.active = null; this.epoch++; }
      this.update({ online, ...(!online ? { busy: null, pending: this.state.pending ? { ...this.state.pending, checked: false, unknown: true } : null } : {}) });
    }
  }
  private begin(busy: SharingState["busy"]): Ticket | null {
    if (!this.state.userId || !this.state.identityKey || !this.state.online || this.state.busy) return null;
    const controller = new AbortController(); this.active = controller; this.update({ busy, notice: null });
    return { epoch: this.epoch, userId: this.state.userId, controller };
  }
  private current(ticket: Ticket) { return this.epoch === ticket.epoch && ticket.userId === this.state.userId && !ticket.controller.signal.aborted; }
  private finish(ticket: Ticket) { if (this.active === ticket.controller) { this.active = null; this.update({ busy: null }); } }
  private merge<T>(before: SharedPage<T>, next: SharedPage<T>, id: (item: T) => string): SharedPage<T> {
    const ids = new Set(before.items.map(id));
    for (const item of next.items) { const key = id(item); if (ids.has(key)) throw new SharingApiError(0, "sharing_response_invalid"); ids.add(key); }
    return { items: [...before.items, ...next.items], nextCursor: next.nextCursor };
  }
  private async selection(spaceId: string, ticket: Ticket) {
    const selected = await this.api.space(spaceId, ticket.userId, ticket.controller.signal);
    const [members, shares, invitations] = await Promise.all([this.api.members(spaceId, ticket.userId, ticket.controller.signal),
      this.api.shares(spaceId, ticket.userId, ticket.controller.signal), selected.role === "owner" ? this.api.invitations(spaceId, ticket.userId, ticket.controller.signal) : Promise.resolve(page<SharedInviteView>())]);
    if (this.current(ticket)) this.update({ selected, members: this.merge(page(), members, item => item.userId),
      shares: this.merge(page(), shares, item => item.childId), invitations: this.merge(page(), invitations, item => item.id) });
  }
  private async read(action: (ticket: Ticket) => Promise<void>) {
    const ticket = this.begin("read"); if (!ticket) return;
    try { await action(ticket); }
    catch (error) { if (this.current(ticket)) this.update({ notice: errorText(error), ...(error instanceof SharingApiError && ["sharing_scope_changed", "invalid_cursor"].includes(error.code)
      ? { spaces: page(), loaded: false, selected: null, members: page(), shares: page(), invitations: page(), invitationToken: null }
      : error instanceof SharingApiError && [401, 403, 404].includes(error.status)
      ? { selected: null, members: page(), shares: page(), invitations: page(), invitationToken: null } : {}) }); }
    finally { this.finish(ticket); }
  }
  loadSpaces = (more = false) => this.read(async ticket => {
    const cursor = more ? this.state.spaces.nextCursor : null; if (more && !cursor) return;
    const next = await this.api.spaces(ticket.userId, ticket.controller.signal, cursor ?? undefined);
    if (this.current(ticket)) this.update({ spaces: this.merge(more ? this.state.spaces : page(), next, item => item.id), loaded: true });
  });
  selectSpace = (spaceId: string) => this.read(async ticket => {
    if (this.state.selected?.id !== spaceId) this.update({ selected: null, members: page(), shares: page(), invitations: page(), invitationToken: null });
    await this.selection(spaceId, ticket);
  });
  refreshSelected = () => { const id = this.state.selected?.id; return id ? this.selectSpace(id) : this.loadSpaces(); };
  more = (kind: "members" | "shares" | "invitations") => this.read(async ticket => {
    const selected = this.state.selected, before = this.state[kind]; if (!selected || !before.nextCursor) return;
    if (kind === "members") {
      const next = await this.api.members(selected.id, ticket.userId, ticket.controller.signal, before.nextCursor);
      if (this.current(ticket)) this.update({ members: this.merge(this.state.members, next, item => item.userId) });
    } else if (kind === "shares") {
      const next = await this.api.shares(selected.id, ticket.userId, ticket.controller.signal, before.nextCursor);
      if (this.current(ticket)) this.update({ shares: this.merge(this.state.shares, next, item => item.childId) });
    } else {
      const next = await this.api.invitations(selected.id, ticket.userId, ticket.controller.signal, before.nextCursor);
      if (this.current(ticket)) this.update({ invitations: this.merge(this.state.invitations, next, item => item.id) });
    }
  });
  private async confirmed(operation: SharingOperation, ticket: Ticket) {
    const command = this.state.pending?.command;
    if (!command || operation.operationId !== command.operationId || operation.action !== command.action
      || "spaceId" in command && (operation.space && operation.space.id !== command.spaceId || operation.exit && operation.exit.spaceId !== command.spaceId))
      throw new SharingApiError(0, "sharing_response_invalid");
    const redacted = "redacted" in operation && operation.redacted === true;
    this.update({ pending: null, receipt: operation, invitationToken: redacted ? null : operation.invitationToken ?? null,
      selected: operation.space, members: page(), shares: page(), invitations: page(), notice: "原操作已確認，正在重新讀取目前狀態。" });
    try {
      const spaces = await this.api.spaces(ticket.userId, ticket.controller.signal);
      if (this.current(ticket)) this.update({ spaces: this.merge(page(), spaces, item => item.id), loaded: true });
      if (operation.space) await this.selection(operation.space.id, ticket);
      if (this.current(ticket)) this.update({ notice: redacted ? "原操作已完成，目前無權讀取詳情。" : "操作已確認，已重新讀取目前家庭資料。" });
    } catch (error) { if (this.current(ticket)) this.update({ notice: redacted ? "原操作已完成，目前無權讀取詳情。" : "原操作已確認；目前資料未能重新讀取。" + errorText(error),
      ...(error instanceof SharingApiError && [401, 403, 404].includes(error.status) ? { selected: null, members: page(), shares: page(), invitations: page(), invitationToken: null } : {}) }); }
  }
  async submit(command: SharingCommand) {
    if (this.state.pending) return;
    const parsed = sharingCommandSchema.safeParse(command);
    if (!parsed.success) { this.update({ notice: "請核對操作欄位及目前家庭版本。" }); return; }
    const ticket = this.begin("write"); if (!ticket) return;
    this.update({ pending: { command: parsed.data, checked: false, unknown: false }, receipt: null, invitationToken: null });
    await this.send(ticket);
  }
  private async send(ticket: Ticket) {
    const pending = this.state.pending; if (!pending) { this.finish(ticket); return; }
    try { const operation = await this.api.submit(pending.command, ticket.userId, ticket.controller.signal);
      if (this.current(ticket)) await this.confirmed(operation, ticket); }
    catch (error) {
      if (this.current(ticket)) {
        // The Server checks the original receipt before versions, so version_conflict proves no commit.
        const rejected = error instanceof SharingApiError && error.status >= 400 && error.status < 500 && noEffectRejections.has(error.code)
          && (!pending.unknown || error.code === "version_conflict");
        this.update({ pending: rejected ? null : { ...pending, checked: false, unknown: true }, notice: rejected ? errorText(error)
          : "提交結果未知。請先查核剛才的操作，再繼續。",
          ...(error instanceof SharingApiError && [401, 403, 404].includes(error.status) ? { selected: null, members: page(), shares: page(), invitations: page() } : {}) });
      }
    } finally { this.finish(ticket); }
  }
  async checkOriginal() {
    if (!this.state.pending) return; const ticket = this.begin("check"); if (!ticket) return;
    const pending = this.state.pending;
    try {
      const operation = await this.api.operation(pending.command.operationId, ticket.userId, ticket.controller.signal);
      if (!this.current(ticket)) return;
      if (operation) await this.confirmed(operation, ticket);
      else this.update({ pending: { ...pending, checked: true, unknown: true }, notice: "暫未查到原結果。可以再次查核，或由你明確選擇繼續剛才的操作。" });
    } catch (error) { if (this.current(ticket)) this.update({ pending: { ...pending, checked: false, unknown: true }, notice: "原結果仍未確認。" + errorText(error),
      ...(error instanceof SharingApiError && [401, 403, 404].includes(error.status) ? { selected: null, members: page(), shares: page(), invitations: page() } : {}) }); }
    finally { this.finish(ticket); }
  }
  async retryOriginal() {
    if (!this.state.pending?.checked) return; const ticket = this.begin("write"); if (!ticket) return;
    this.update({ pending: { ...this.state.pending, checked: false } }); await this.send(ticket);
  }
  clearInvitationToken = () => this.update({ invitationToken: null });
  dispose() { this.active?.abort(); this.epoch++; this.listeners.clear(); this.state = initial(null, null, false); }
}
