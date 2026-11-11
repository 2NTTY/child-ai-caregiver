import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import type { IncomingSharePayload } from '../incoming-share';

type Payload = IncomingSharePayload & { localShareId?: string };
type SharedPayload = Payload & { localShareId: string };
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const receiptName = new RegExp('^ready-(' + uuid + ')$');
const itemId = new RegExp('^(' + uuid + '):(0|[1-9]|1[0-9])$');
const epochId = new RegExp('^' + uuid + '$');
const MAX_ITEMS = 20, MAX_RECEIPTS_PER_READ = 64, MAX_MANIFEST_BYTES = 48 * 1024;
const MAX_BODY_BYTES = 256 * 1024 * 1024;
const fileTypes = new Set(['file', 'image', 'audio', 'video']);
function utf8Bytes(value: string) {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return Infinity;
      bytes += 4;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return Infinity;
    else bytes += unit <= 0x7f ? 1 : unit <= 0x7ff ? 2 : 3;
  }
  return bytes;
}
const control = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/;
const validIdentity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 2048
  && Number.isFinite(utf8Bytes(value)) && !control.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const safeName = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200
  && utf8Bytes(value) <= 255 && value.trim() === value && !value.startsWith('.') && !control.test(value)
  && !/[\\/:]/.test(value) && !/%[0-9a-f]{2}/i.test(value);
const rejected = () => new Error('incoming_share_mailbox_invalid');

/** Main-app reader for atomically published extension receipts; never interprets an external path. */
export function createIosShareMailbox() {
  const staged = new Set<string>(), offered = new Map<string, string>();
  let identity: string | null = null, failedClear = false, scanAfter = '';
  function root(create = false) {
    const group = Paths.appleSharedContainers['group.org.yuyoufang.app'];
    if (!group) return null;
    const directory = new Directory(group, 'incoming-v1');
    if (create && !directory.exists) directory.create({ intermediates: true, idempotent: true });
    return directory.exists ? directory : null;
  }
  function clearing(directory: Directory) {
    return failedClear || new File(directory, 'clear-pending.json').exists || new Directory(directory, 'clear-pending.json').exists;
  }
  function receipts(directory: Directory) {
    return directory.list().filter((entry): entry is Directory => entry instanceof Directory && receiptName.test(entry.name))
      .map(entry => new Directory(directory, entry.name)).sort((first, second) => first.name.localeCompare(second.name));
  }
  function wipeCommitted(directory: Directory) {
    failedClear = true; offered.clear(); staged.clear();
    const marker = new File(directory, 'clear-pending.json');
    if (!marker.exists) marker.create();
    const nextEpoch = randomUUID();
    if (!epochId.test(nextEpoch)) throw rejected();
    const epoch = new File(directory, 'device-epoch');
    if (!epoch.exists) epoch.create();
    epoch.write(nextEpoch);
    if (deviceEpoch(directory) !== nextEpoch) throw rejected();
    for (const receipt of receipts(directory)) receipt.delete();
    marker.delete(); failedClear = false; scanAfter = '';
  }
  function readText(file: File, limit: number): string {
    if (!file.exists || file.size < 1 || file.size > limit) throw rejected();
    const text = file.textSync();
    if (text.length > limit || utf8Bytes(text) > limit) throw rejected();
    return text;
  }
  function readJson(file: File, limit: number): unknown {
    return JSON.parse(readText(file, limit));
  }
  function deviceEpoch(directory: Directory) {
    const file = new File(directory, 'device-epoch');
    if (!file.exists) {
      if (new Directory(directory, 'device-epoch').exists) throw rejected();
      return 'initial';
    }
    const value = readText(file, 36);
    if (!epochId.test(value)) throw rejected(); return value;
  }
  function receiptEpoch(directory: Directory) {
    const value = readText(new File(directory, 'epoch'), 36);
    if (value !== 'initial' && !epochId.test(value)) throw rejected(); return value;
  }
  function owner(directory: Directory): string | null {
    const file = new File(directory, 'owner.json');
    if (!file.exists) {
      if (new Directory(directory, 'owner.json').exists) throw rejected();
      return null;
    }
    const value = readJson(file, 16 * 1024);
    if (!object(value) || Object.keys(value).length !== 1 || !validIdentity(value.identity)) throw rejected();
    return value.identity;
  }
  function cleanupConsumed(directory: Directory) {
    for (let index = 0; index < MAX_ITEMS; index++) if (new File(new Directory(directory, String(index)), 'item.json').exists) return false;
    try { directory.delete(); } catch { /* Retry unpublished body cleanup on a later mailbox read. */ }
    return true;
  }
  function item(directory: Directory, receipt: string, index: number): { payload: SharedPayload; directory: Directory; file?: File } {
    const selected = new Directory(directory, String(index));
    if (!selected.exists) throw rejected();
    const value = readJson(new File(selected, 'item.json'), MAX_MANIFEST_BYTES);
    if (!object(value)) throw rejected();
    const localShareId = receipt + ':' + index;
    if (value.shareType === 'text' || value.shareType === 'url') {
      if (Object.keys(value).length !== 2 || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 10_000
        || !Number.isFinite(utf8Bytes(value.text)) || value.text.includes('\0')) throw rejected();
      return { payload: { localShareId, shareType: value.shareType, value: value.text }, directory: selected };
    }
    if (typeof value.shareType !== 'string' || !fileTypes.has(value.shareType) || Object.keys(value).length !== 3
      || !safeName(value.fileName) || typeof value.mimeType !== 'string' || value.mimeType.length > 160
      || !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(value.mimeType)) throw rejected();
    const file = new File(new Directory(selected, 'body'), value.fileName);
    if (!file.exists || file.size < 1 || file.size > MAX_BODY_BYTES) throw rejected();
    return { payload: { localShareId, shareType: value.shareType as SharedPayload['shareType'], value: localShareId, mimeType: value.mimeType }, directory: selected, file };
  }
  function checked(payload: Payload, selectedIdentity: string) {
    if (!validIdentity(selectedIdentity) || offered.get(payload.localShareId ?? '') !== selectedIdentity) throw rejected();
    const match = typeof payload.localShareId === 'string' && itemId.exec(payload.localShareId);
    const base = root();
    if (!match || !base || clearing(base)) throw rejected();
    const directory = new Directory(base, 'ready-' + match[1]);
    if (receiptEpoch(directory) !== deviceEpoch(base)) throw rejected();
    const bound = owner(directory);
    if (!directory.exists || bound !== null && bound !== selectedIdentity) throw rejected();
    const current = item(directory, match[1], Number(match[2]));
    if (payload.shareType !== current.payload.shareType || payload.value !== current.payload.value || payload.mimeType !== current.payload.mimeType) throw rejected();
    return { ...current, receipt: directory };
  }
  return {
    read(capacity = MAX_ITEMS, nextIdentity?: string | null): SharedPayload[] {
      identity = validIdentity(nextIdentity) ? nextIdentity : null;
      const result: SharedPayload[] = [];
      if (!identity || !Number.isInteger(capacity) || capacity <= 0) return result;
      const limit = Math.min(capacity, MAX_ITEMS);
      try {
        const base = root(); if (!base) return result;
        if (clearing(base)) wipeCommitted(base);
        const epoch = deviceEpoch(base);
        const finish = () => !clearing(base) && deviceEpoch(base) === epoch ? result : [];
        const all = receipts(base), pivot = all.findIndex(directory => directory.name > scanAfter);
        const ordered = pivot < 0 ? all : [...all.slice(pivot), ...all.slice(0, pivot)];
        for (const directory of ordered.slice(0, MAX_RECEIPTS_PER_READ)) {
          const receipt = receiptName.exec(directory.name)![1]!;
          // Finish this receipt on the next capacity-limited read before advancing the bounded scan.
          if (result.length >= limit) break;
          try {
            if (receiptEpoch(directory) !== epoch) {
              try { directory.delete(); } catch { /* Retry stale committed receipt cleanup later. */ }
              scanAfter = directory.name; continue;
            }
            if (cleanupConsumed(directory)) { scanAfter = directory.name; continue; }
            const bound = owner(directory);
            if (bound !== null && bound !== identity) { scanAfter = directory.name; continue; }
            for (let index = 0; index < MAX_ITEMS; index++) {
              if (result.length >= limit) return finish();
              const id = receipt + ':' + index;
              if (staged.has(id)) continue;
              try { const current = item(directory, receipt, index); offered.set(id, identity); result.push(current.payload); }
              catch { /* One malformed or consumed item must not suppress its neighbors. */ }
            }
          } catch { /* A damaged owner marker hides only its own committed receipt. */ }
          scanAfter = directory.name;
        }
        return finish();
      } catch { return []; /* An unavailable app group or invalid epoch has no readable input. */ }
    },
    acknowledge(payloads: readonly Payload[], selectedIdentity?: string | null) {
      if (!validIdentity(selectedIdentity) || selectedIdentity !== identity) throw rejected();
      if (payloads.length > MAX_ITEMS) throw rejected();
      const selected = payloads.map(payload => checked(payload, selectedIdentity));
      for (const directory of new Map(selected.map(value => [value.receipt.uri, value.receipt])).values()) {
        const bound = owner(directory);
        if (bound === selectedIdentity) continue;
        if (bound !== null) throw rejected();
        // A partial write leaves an unreadable owner marker, never an unowned receipt for a different account.
        const marker = new File(directory, 'owner.json'); marker.create(); marker.write(JSON.stringify({ identity: selectedIdentity }));
        if (owner(directory) !== selectedIdentity) throw rejected();
      }
      for (const value of selected) staged.add(value.payload.localShareId!);
    },
    clear() {
      failedClear = true; offered.clear(); staged.clear(); identity = null;
      const base = root(true);
      if (!base) { failedClear = false; return; }
      wipeCommitted(base);
    },
    discard(payload: Payload) {
      if (!identity) throw rejected();
      const current = checked(payload, identity);
      // Removing publication first prevents resurrection if physical body cleanup fails.
      new File(current.directory, 'item.json').delete();
      staged.delete(payload.localShareId!); offered.delete(payload.localShareId!);
      try { current.directory.delete(); } catch { /* The unpublished item may be removed by later account cleanup. */ }
      cleanupConsumed(current.receipt);
    },
    file(payload: Payload): File {
      if (!identity) throw rejected();
      const current = checked(payload, identity);
      if (!current.file) throw rejected(); return current.file;
    },
  };
}
