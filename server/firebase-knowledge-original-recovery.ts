import { z } from "zod";
import { knowledgeOriginalManifest, knowledgeOriginalName, putKnowledgeOriginalObject, readKnowledgeOriginalObject,
  type KnowledgeOriginalBucket, type KnowledgeOriginalManifest } from "./firestore-knowledge-originals.ts";
import { FIREBASE_PHOTO_BACKUP_MIN_RETENTION_MS, FIREBASE_PHOTO_BACKUP_MAX_RETENTION_MS } from "./firebase-photo-recovery.ts";

export const knowledgeOriginalBackup = z.strictObject({
  path: z.string().min(1).max(300), original: knowledgeOriginalManifest,
  generation: knowledgeOriginalManifest.shape.generation,
});
type Entry = z.infer<typeof knowledgeOriginalBackup>;
export function createKnowledgeOriginalRecovery(primary: KnowledgeOriginalBucket, backup: KnowledgeOriginalBucket) {
  if (primary.bucketName === backup.bucketName) throw Error("knowledge_original_backup_binding");
  function address(id: string, m: KnowledgeOriginalManifest) {
    return "firebase-backups/v1/" + z.uuid().parse(id) + "/knowledge/" + m.sourceId + "-" + m.contentHash;
  }
  function validate(m: KnowledgeOriginalManifest) {
    if (m.bucketName !== primary.bucketName) throw Error("knowledge_original_backup_binding");
  }
  return {
    async capture(backupId: string, until: string, path: string, m: KnowledgeOriginalManifest): Promise<Entry> {
      validate(m);
      const ttl = Date.parse(z.iso.datetime({offset:true}).parse(until)) - Date.now();
      if (ttl < FIREBASE_PHOTO_BACKUP_MIN_RETENTION_MS || ttl > FIREBASE_PHOTO_BACKUP_MAX_RETENTION_MS)
        throw Error("knowledge_original_backup_retention");
      const bytes = await readKnowledgeOriginalObject(primary, knowledgeOriginalName(m), m, m.generation);
      const revision = await putKnowledgeOriginalObject(backup, address(backupId, m), m, bytes, until);
      await readKnowledgeOriginalObject(backup, address(backupId, m), m, revision, until);
      return { path, original: m, generation: revision };
    },
    async recover(m: KnowledgeOriginalManifest, saved?: { id: string; until: string; entry: Entry }) {
      validate(m);
      const name = knowledgeOriginalName(m);
      if (!saved) {
        await readKnowledgeOriginalObject(primary, name, m, m.generation);
        return m;
      }
      if (Date.parse(z.iso.datetime({offset:true}).parse(saved.until)) <= Date.now()) throw Error("knowledge_original_backup_expired");
      const entry = knowledgeOriginalBackup.parse(saved.entry);
      const original = knowledgeOriginalManifest.parse(m);
      if (Object.entries(original).some(([key,v]) => entry.original[key as keyof KnowledgeOriginalManifest] !== v))
        throw Error("knowledge_original_backup_binding");
      const bytes = await readKnowledgeOriginalObject(backup, address(saved.id, m), m, entry.generation, saved.until);
      // Existing generations stay pinned. Recreate only a genuinely absent object.
      try {
        await readKnowledgeOriginalObject(primary, name, m, m.generation);
        return m;
      } catch (error) {
        if ((error as {code?:number})?.code !== 404) throw error;
      }
      const revision = await putKnowledgeOriginalObject(primary, name, m, bytes);
      return { ...m, generation: revision };
    },
  };
}
