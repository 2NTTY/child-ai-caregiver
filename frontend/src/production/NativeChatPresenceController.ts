import { createNativePushApi, NativePushApiError, type NativeChatPresence, type NativePushApi } from "../../../src/client/native-push-api.ts";

/** One serialized CAS stream per native session, shared by settings and the chat heartbeat. */
export class NativeChatPresenceController {
  private value: NativeChatPresence | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private abort = new AbortController();
  private childId: string | null = null;
  private revision = 0;
  private api: Pick<NativePushApi, "chatPresence" | "updateChatPresence">;
  private userId: string;
  private current: () => boolean;
  constructor(api: Pick<NativePushApi, "chatPresence" | "updateChatPresence">, userId: string, current: () => boolean) {
    this.api = api; this.userId = userId; this.current = current;
  }
  private live() { return !this.abort.signal.aborted && this.current(); }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const task = this.queue.catch(() => undefined).then(async () => {
      if (!this.live()) throw new NativePushApiError(409, "session_changed");
      return action();
    });
    this.queue = task; return task;
  }
  read() {
    return this.serialize(async () => {
      const next = await this.api.chatPresence(this.abort.signal, this.userId);
      if (!this.live()) throw new NativePushApiError(409, "session_changed");
      this.value = next; return next;
    });
  }
  private async write(enabled?: boolean, bindingId?: string, preview?: boolean) {
    if (!this.value) this.value = await this.api.chatPresence(this.abort.signal, this.userId);
    if (!this.live()) throw new NativePushApiError(409, "session_changed");
    if (bindingId !== undefined && this.value.bindingId !== bindingId) throw new NativePushApiError(409, "binding_changed");
    if (preview !== undefined && enabled !== true && !this.value.chatNotificationsEnabled) throw new NativePushApiError(409, "chat_consent_disabled");
    try {
      const next = await this.api.updateChatPresence({ childId: this.childId, expectedPresenceVersion: this.value.presenceVersion,
        ...(bindingId === undefined ? {} : { bindingId }),
        ...(enabled === undefined ? {} : { chatNotificationsEnabled: enabled }),
        ...(preview === undefined ? {} : { chatPreviewEnabled: preview }) }, this.abort.signal, this.userId);
      if (!this.live()) throw new NativePushApiError(409, "session_changed");
      if (bindingId !== undefined && next.bindingId !== bindingId) throw new NativePushApiError(409, "binding_changed");
      this.value = next; return next;
    } catch (error) {
      // Unknown writes and CAS conflicts are read back, never blindly replayed.
      if (this.live()) {
        try { this.value = await this.api.chatPresence(this.abort.signal, this.userId); } catch { this.value = null; }
      }
      throw error;
    }
  }
  setEnabled(enabled: boolean, bindingId?: string, preview?: boolean) { return this.serialize(() => this.write(enabled, bindingId, preview)); }
  setPreviewEnabled(enabled: boolean, bindingId: string) { return this.serialize(() => this.write(undefined, bindingId, enabled)); }
  foreground(childId: string | null) {
    this.childId = childId; const revision = ++this.revision;
    return this.serialize(() => revision === this.revision ? this.write() : Promise.resolve(this.value));
  }
  dispose() { this.revision++; this.childId = null; this.abort.abort(); this.value = null; }
}

type PresenceOwner = { apiBaseUrl: string; fetcher: typeof fetch; getSnapshot(): { identityKey: string | null; sessionGeneration: number } };
const controllers = new WeakMap<PresenceOwner, { identity: string; generation: number; controller: NativeChatPresenceController }>();
export function nativeChatPresenceFor(owner: PresenceOwner, identity: string, userId: string) {
  const generation = owner.getSnapshot().sessionGeneration;
  const previous = controllers.get(owner);
  if (previous?.identity === identity && previous.generation === generation) return previous.controller;
  previous?.controller.dispose();
  const controller = new NativeChatPresenceController(createNativePushApi(owner.apiBaseUrl, owner.fetcher, { chatPresenceVersion: 2 }), userId,
    () => owner.getSnapshot().identityKey === identity && owner.getSnapshot().sessionGeneration === generation);
  controllers.set(owner, { identity, generation, controller }); return controller;
}
