import { avatarAdmissionSchema, type AvatarAdmission } from './avatar-config.ts';
import { domainReject } from './firestore-domain-data.ts';

/** Bounds request-stream/base64 allocations before decoding. Local only, not a cluster-wide throughput quota. */
export function createAvatarIngress(configInput: AvatarAdmission) {
  const config = avatarAdmissionSchema.parse(configInput), actors = new Set<string>();
  const limit = config.decodeConcurrency + config.queueLimit;
  return {
    acquire(actorKey: string) {
      if (!actorKey || actors.has(actorKey) || actors.size >= limit) domainReject('avatar_busy', 429);
      actors.add(actorKey); let live = true, used = false;
      return {
        consume() { if (!live || used) domainReject('avatar_unavailable', 503); used = true; },
        release() { if (!live) return; live = false; actors.delete(actorKey); },
      };
    },
    state() { return { admitted: actors.size, limit }; },
  };
}
