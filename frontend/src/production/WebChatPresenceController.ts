import { createWebPushApi, WebPushApiError, type WebPushApi } from "../../../src/client/web-push-api.ts";
import type { NativeChatPresence } from "../../../src/shared/native-push.ts";
import type { WebPushSubscription } from "../../../src/shared/web-push.ts";

/** One CAS stream per browser installation and authenticated owner. */
export class WebChatPresenceController {
  private value: NativeChatPresence | null = null;
  private binding: { id: string; version: number } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private abort = new AbortController();
  private childId: string | null = null;
  private revision = 0;
  private bindingRevision = 0;
  private api: Pick<WebPushApi, "chatPresence" | "updateChatPresence">;
  private userId: string;
  private current: () => boolean;
  constructor(api: Pick<WebPushApi, "chatPresence" | "updateChatPresence">, userId: string, current: () => boolean) {
    this.api = api; this.userId = userId; this.current = current;
  }
  private live() { return !this.abort.signal.aborted && this.current(); }
  bind(binding: { id: string; version: number } | null) {
    if (this.binding?.id === binding?.id && this.binding?.version === binding?.version) return;
    this.binding = binding; this.value = null; this.bindingRevision++; this.revision++;
  }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const revision = this.bindingRevision;
    const task = this.queue.catch(() => undefined).then(async () => {
      if (!this.live() || revision !== this.bindingRevision) throw new WebPushApiError(409, "session_changed");
      return action();
    });
    this.queue = task; return task;
  }
  private async load() {
    const binding = this.binding, revision = this.bindingRevision;
    if (!binding || !this.live()) throw new WebPushApiError(409);
    const value = await this.api.chatPresence(binding.id, this.abort.signal, this.userId);
    if (!this.live() || revision !== this.bindingRevision || value.bindingId !== binding.id) throw new WebPushApiError(409);
    this.value = value; return value;
  }
  read() { return this.serialize(() => this.load()); }
  private async write(enabled?: boolean, preview?: boolean, subscription?: WebPushSubscription) {
    const binding = this.binding, revision = this.bindingRevision;
    if (!binding) throw new WebPushApiError(409);
    const value = this.value ?? await this.load();
    if (!this.live() || revision !== this.bindingRevision) throw new WebPushApiError(409, "session_changed");
    if (preview !== undefined && enabled !== true && !value.chatNotificationsEnabled) throw new WebPushApiError(409);
    try {
      const next = await this.api.updateChatPresence({ bindingId: binding.id, expectedBindingVersion: binding.version,
        expectedPresenceVersion: value.presenceVersion, childId: this.childId,
        ...(enabled === undefined ? {} : { chatNotificationsEnabled: enabled }),
        ...(preview === undefined ? {} : { chatPreviewEnabled: preview }), ...(subscription ? { subscription } : {}) }, this.abort.signal, this.userId);
      if (!this.live() || revision !== this.bindingRevision || next.bindingId !== binding.id) throw new WebPushApiError(409, "session_changed");
      this.value = next; return next;
    } catch (error) {
      // Read an unknown write or conflict; an explicit preference is never replayed.
      if (this.live() && revision === this.bindingRevision) { try { await this.load(); } catch { this.value = null; } }
      throw error;
    }
  }
  setEnabled(enabled: boolean, preview: boolean | undefined, subscription: WebPushSubscription) {
    return this.serialize(() => this.write(enabled, preview, subscription));
  }
  setPreviewEnabled(enabled: boolean, subscription: WebPushSubscription) { return this.serialize(() => this.write(undefined, enabled, subscription)); }
  foreground(childId: string | null) {
    this.childId = childId; const revision = ++this.revision;
    if (!this.binding) return Promise.resolve(null);
    return this.serialize(async () => {
      if (revision !== this.revision) return this.value;
      const value = this.value ?? await this.load();
      return value.chatNotificationsEnabled && revision === this.revision ? this.write() : value;
    });
  }
  dispose() { this.abort.abort(); this.binding = null; this.value = null; this.childId = null; this.revision++; this.bindingRevision++; }
}

type PresenceOwner = { apiBaseUrl: string; fetcher: typeof fetch; getSnapshot(): { identityKey: string | null; sessionGeneration: number } };
const controllers = new WeakMap<PresenceOwner, { identity: string; generation: number; controller: WebChatPresenceController }>();
export function webChatPresenceFor(owner: PresenceOwner, identity: string, userId: string) {
  const generation = owner.getSnapshot().sessionGeneration, previous = controllers.get(owner);
  if (previous?.identity === identity && previous.generation === generation) return previous.controller;
  previous?.controller.dispose();
  const controller = new WebChatPresenceController(createWebPushApi(owner.apiBaseUrl, owner.fetcher, { version: 2 }), userId,
    () => owner.getSnapshot().identityKey === identity && owner.getSnapshot().sessionGeneration === generation);
  controllers.set(owner, { identity, generation, controller }); return controller;
}
