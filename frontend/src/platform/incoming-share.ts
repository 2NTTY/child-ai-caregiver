import type { IncomingSharePlatform } from '../incoming-share';

/** Web and other base targets do not register a system-share receiver. */
export function createIncomingSharePlatform(): IncomingSharePlatform {
  return { read: () => [], clear() {}, subscribe: () => () => {},
    async prepare() { throw new Error('incoming_share_unavailable'); } };
}
