import { HandoverArchiveError } from './handover-archive.ts';

export const attachmentSections = { photos: ['photo_content', 'photoId'], voices: ['voice_content', 'voiceId'],
  files: ['file_content', 'fileId'], child_avatar: ['child_avatar_content', 'childId'] } as const;
export type AttachmentSection = keyof typeof attachmentSections;
export const attachmentSupplementModules = { file_content: 'files', voice_content: 'voices', photo_content: 'photos',
  child_avatar_content: 'child_avatar', voice_transcripts: 'voices' } as const;
export type AttachmentSupplement = keyof typeof attachmentSupplementModules;
export type PackageMediaFilter = (section: AttachmentSection, id: string) => boolean;

function fail(): never { throw new HandoverArchiveError('package_attachment_content_mismatch'); }
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const isAttachmentHead = (section: string): section is AttachmentSection => Object.hasOwn(attachmentSections, section);
export const isAttachmentSupplement = (section: string): section is AttachmentSupplement => Object.hasOwn(attachmentSupplementModules, section);
const key = (child: string, section: AttachmentSection, id: string) => JSON.stringify([child, section, id]);

/** The ZIP can list content before metadata. Retain only small, immutable identity fields until both sides are available. */
type Reference = { key: string; version: number; ready: boolean; assetId?: unknown; mime?: unknown; bytes?: unknown; hash?: unknown; duration?: unknown };
function reference(section: AttachmentSection | AttachmentSupplement, childId: string, raw: unknown): Reference {
  const row = object(raw), supplement = isAttachmentSupplement(section), kind = supplement ? attachmentSupplementModules[section] : section;
  const transcript = section === 'voice_transcripts', value = transcript ? object(row.voice) : row;
  const id = kind === 'child_avatar' ? childId : (!supplement || transcript ? value.id : row[attachmentSections[kind][1]]);
  if (typeof id !== 'string' || typeof value.version !== 'number') fail();
  const info = supplement ? value : kind === 'photos' ? object(row.metadata) : kind === 'child_avatar' ? object(row.asset) : row;
  return { key: key(childId, kind, id), version: value.version,
    ready: supplement || (kind === 'child_avatar' ? !!row.asset : row.state === 'ready'),
    assetId: kind === 'child_avatar' ? object(row.asset).id : undefined,
    mime: info.mimeType, bytes: info.bytes, hash: info.sha256, duration: info.durationMs };
}

export class DatedPackageMedia {
  private heads = new Map<string, Reference>();
  private companions: { ref: Reference; transcript: boolean }[] = [];

  addHead(section: AttachmentSection, childId: string, row: unknown) {
    const ref = reference(section, childId, row);
    if (this.heads.has(ref.key)) fail();
    this.heads.set(ref.key, ref);
  }
  permitsBytes(childId: string, kind: AttachmentSection, id: string) {
    return this.heads.get(key(childId, kind, id))?.ready === true;
  }
  hasParent(section: AttachmentSupplement, childId: string, row: unknown) {
    return this.heads.has(reference(section, childId, row).key);
  }
  addSupplement(section: AttachmentSupplement, childId: string, row: unknown) {
    this.companions.push({ ref: reference(section, childId, row), transcript: section === 'voice_transcripts' });
  }
  verify() {
    const contents = new Set<string>(), transcripts = new Set<string>();
    for (const { ref, transcript } of this.companions) {
      const parent = this.heads.get(ref.key), seen = transcript ? transcripts : contents;
      // A message can bind an older voice metadata version to the same immutable recording.
      if (!parent?.ready || seen.has(ref.key) || parent.assetId !== ref.assetId
        || (transcript ? ref.version > parent.version || ref.duration !== parent.duration : ref.version !== parent.version)
        || ref.mime !== parent.mime || ref.bytes !== parent.bytes || ref.hash !== parent.hash) fail();
      seen.add(ref.key);
    }
    for (const parent of this.heads.values()) if (parent.ready && !contents.has(parent.key)) fail();
  }
}
