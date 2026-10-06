import assert from "node:assert/strict";
import { test } from "node:test";
import { canPreviewAssistantDraft, createAssistantDraftOwner, photoAttachment, type AssistantAttachment } from "../src/assistant-draft.ts";
import { quickInputDirection, recordsMoreDirection } from "../src/components/navigation/quick-input-gesture.ts";
const attachment = (id: string, onDispose: () => void, kind: AssistantAttachment["kind"] = "file"): AssistantAttachment => ({ id, kind, fileName: "synthetic.txt", mimeType: "text/plain", bytes: 10, dispose: onDispose });

test("one scoped draft combines input kinds, permits attachment-only preview and releases replacements", () => {
  const owner = createAssistantDraftOwner(); let removed = 0;
  owner.retainScope("a"); assert.equal(canPreviewAssistantDraft(owner.getSnapshot()), false);
  owner.setText("a", "  "); owner.add("a", attachment("file", () => removed++));
  owner.add("a", attachment("voice", () => removed++, "voice"));
  assert.equal(canPreviewAssistantDraft(owner.getSnapshot()), true);
  assert.equal(owner.getSnapshot().attachments.length, 2);
  owner.add("a", attachment("replacement", () => removed++), "file"); assert.equal(removed, 1);
  owner.remove("a", "voice"); assert.equal(removed, 2);
  owner.clear("a"); assert.equal(removed, 3); assert.equal(canPreviewAssistantDraft(owner.getSnapshot()), false);
  owner.dispose(); assert.equal(removed, 3);
});
test("scope changes release media, preserve isolated text semantics and reject late callbacks", () => {
  const owner = createAssistantDraftOwner(); let removed = 0;
  owner.retainScope("a"); owner.setText("a", "A draft"); owner.add("a", attachment("a", () => removed++));
  owner.retainScope("b"); assert.equal(owner.getSnapshot().text, ""); assert.equal(removed, 1);
  assert.equal(owner.add("a", attachment("late", () => removed++)), false); assert.equal(removed, 2);
  owner.setText("a", "stale"); owner.setText("b", "B draft");
  owner.retainScope("a"); assert.equal(owner.getSnapshot().text, "A draft"); assert.equal(owner.getSnapshot().attachments.length, 0);
  owner.retainScope(null); assert.equal(owner.getSnapshot().text, ""); owner.dispose();
});
test("mobile directions select only the three approved sectors and cancel at origin or outside", () => {
  assert.equal(quickInputDirection(0, -100), "file"); assert.equal(quickInputDirection(80, -80), "voice"); assert.equal(quickInputDirection(100, 0), "text");
  for (const [x, y] of [[0, 0], [0, 30], [-60, -80], [210, 0], [0, -200]]) assert.equal(quickInputDirection(x, y), null);
  assert.equal(recordsMoreDirection(0, -60), true); assert.equal(recordsMoreDirection(80, -60), false); assert.equal(recordsMoreDirection(0, 0), false);
});

test("photo adapters share one scoped attachment owner and release the original once", () => {
  const owner = createAssistantDraftOwner(); let disposed = 0;
  const photo = { fileName: "synthetic.png", mimeType: "image/png", bytes: 10, sha256: "synthetic", imageSource: { uri: "synthetic-only" }, dispose: () => disposed++ };
  const media = photoAttachment(photo);
  assert.equal(media.photo, photo); assert.equal(media.dispose, photo.dispose);
  owner.retainScope("a"); owner.add("a", media); owner.add("a", media);
  assert.equal(owner.getSnapshot().attachments.length, 1);
  owner.retainScope("b"); assert.equal(disposed, 1);
  owner.clear("b"); owner.dispose(); assert.equal(disposed, 1);
});
