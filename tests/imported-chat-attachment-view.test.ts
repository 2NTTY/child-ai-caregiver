import test from 'node:test';
import assert from 'node:assert/strict';
import { importedAttachmentView } from '../frontend/src/imported-chat-attachment.ts';
import type { ImportedChatMessage } from '../src/shared/chat-imports.ts';
import type { ChatFileAttachment } from '../src/shared/chat-files.ts';

test('imported media resolves local immutable bytes without treating source IDs as local or reviving deleted assets', () => {
  const childId = '11111111-1111-4111-8111-111111111111';
  const localId = '22222222-2222-4222-8222-222222222222';
  const sourceId = '33333333-3333-4333-8333-333333333333';
  const messageId = '44444444-4444-4444-8444-444444444444';
  const file = { id: sourceId, version: 42, sha256: 'a'.repeat(64), bytes: 7, mimeType: 'text/plain' };
  const item: Pick<ImportedChatMessage, 'childId' | 'attachment' | 'message'> = { childId,
    attachment: { kind: 'files', resource: { id: localId, version: 2 } },
    message: { id: messageId, childId: sourceId, authorUserId: 'source-author', role: 'user', text: '',
      inReplyTo: null, createdAt: '2026-10-30T00:00:00Z', file } };
  const actual: ChatFileAttachment = { ...file, id: localId, version: 3, childId,
    createdAt: '2026-10-30T00:00:00Z', state: 'ready', fileName: 'example.txt', messageId };
  assert.deepEqual(importedAttachmentView(item, { kind: 'files', value: actual }),
    { kind: 'files', reference: { ...file, id: localId, version: 3 }, messageId });
  for (const change of [{ id: sourceId }, { childId: sourceId }, { version: 1 }, { state: 'deleted' as const },
    { sharedSpaceId: sourceId }, { sha256: 'b'.repeat(64) }, { bytes: 8 }, { mimeType: 'image/png' }]) {
    assert.equal(importedAttachmentView(item, { kind: 'files', value: { ...actual, ...change } }), null);
  }
  assert.equal(importedAttachmentView({ ...item, attachment: null }, { kind: 'files', value: actual }), null);
  const voice = { ...file, mimeType: 'audio/mp4' as const, durationMs: 4000 };
  const audioItem = { ...item, attachment: { kind: 'voices' as const, resource: { id: localId, version: 2 } },
    message: { ...item.message, file: undefined, voice } };
  const audio = { ...actual, mimeType: voice.mimeType, durationMs: 4000, messageId: null };
  assert.equal(importedAttachmentView(audioItem, { kind: 'voices', value: audio })?.kind, 'voices');
  assert.equal(importedAttachmentView(audioItem, { kind: 'voices', value: { ...audio, durationMs: 5000 } }), null);
});
