import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createAccountDataStore, createAccountExportStore } from "../server/account-data.ts";
import { createRecordStore } from "../server/records.ts";
import { createCareStore } from "../server/care.ts";
import { createChatStore } from "../server/chat.ts";
import { createFamilyDocumentStore } from "../server/family-document-store.ts";
import { emptyCareDetails } from "../src/shared/care.ts";

/** Prepared local SQL flow. The primary runner owns the isolated database, native auth,
 * protected journal/attachments, backup hook, cleanup and first-failure stop policy.
 * No standalone execution, model, external delivery or worker daemon is supported. */
export async function runDataAcceptance({ pool, cipher, journal, photoFiles, authFixture, beforeErasure }) {
  assert.ok(authFixture?.userId && authFixture.password);
  assert.match((await pool.query("SELECT current_database() AS name")).rows[0].name, /^p2_a08_/,
    "Only a fresh isolated A08 database may run this flow");
  const data = createAccountDataStore(pool, cipher, journal), exporter = createAccountExportStore(pool, cipher, { photoFiles });
  const records = createRecordStore(pool, cipher, true, data.recordChildIntent), care = createCareStore(pool, cipher, true), chat = createChatStore(pool, cipher, true);
  let calls = 0;
  async function call(fn) { assert.ok(++calls <= 60, "A08 data acceptance exceeded 60 business calls"); return fn(); }
  const userId = authFixture.userId, child = await call(() => records.createChildForUser(userId, { displayName: "Synthetic A08 child" }));
  const record = await call(() => care.create(userId, child.id, { text: "Synthetic A08 ordinary observation.", details: emptyCareDetails(), source: "Synthetic acceptance fixture" }));
  const message = await call(() => chat.createUserMessageForUser(userId, child.id, "Synthetic A08 private message."));
  const document = await call(() => createFamilyDocumentStore(pool, cipher).create(userId, child.id,
    { kind: "preparation", purpose: "appointment", title: "Synthetic A08 document", eventDate: null, period: { from: "2026-10-01", to: "2026-10-08" } }, randomUUID()));
  assert.ok(record && message && document);
  const manifest = await call(() => exporter.page(userId, { section: "manifest" }));
  const descriptor = manifest.items[0], scopeVersion = manifest.scopeVersion, coverage = [];
  assert.equal(descriptor.format, "yuban-personal-data:1");
  let exportedRecord = false, exportedMessage = false, exportedDocumentContent = false;
  for (const section of descriptor.sections) {
    const children = section.childScoped ? [child.id] : [undefined];
    for (const childId of children) {
      let cursor, pages = 0, count = 0; const seen = new Set();
      do {
        const page = await call(() => exporter.page(userId, { section: section.section, ...(childId ? { childId } : {}), scopeVersion, ...(cursor ? { cursor } : {}) }));
        assert.equal(page.scopeVersion, scopeVersion); assert.equal(page.complete, page.nextCursor === null); pages++; count += page.items.length;
        if (section.section === "care") exportedRecord ||= page.items.some(item => item.id === record.id && item.text === "Synthetic A08 ordinary observation.");
        if (section.section === "chat") exportedMessage ||= page.items.some(item => item.id === message.id && item.text.includes("Synthetic A08 private message."));
        if (section.section === "document_content") exportedDocumentContent ||= page.items.some(item => item.documentId === document.id && !item.invalidated && item.text.length > 0);
        const serialized = JSON.stringify(page);
        assert.equal(/api_key_encrypted|passwordHash|subscription_encrypted|callback_encrypted|sessionToken/.test(serialized), false);
        if (page.nextCursor) { assert.equal(seen.has(page.nextCursor), false); seen.add(page.nextCursor); }
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      coverage.push({ section: section.section, childScoped: Boolean(childId), pages, items: count, complete: true });
    }
  }
  assert.ok(exportedRecord && exportedMessage && exportedDocumentContent);
  await call(() => exporter.page(userId, { section: "manifest", scopeVersion }));
  await assert.rejects(call(() => exporter.page("a08-unadmitted-" + randomUUID(), { section: "profile", childId: child.id })), /unauthorized|export_scope_changed/);
  await beforeErasure?.();
  assert.equal(await call(() => records.deleteChildForUser(userId, child.id)), true);
  await data.replay();
  assert.equal((await pool.query("SELECT 1 FROM children WHERE id=$1", [child.id])).rowCount, 0);
  const operationId = randomUUID(), prepared = await call(() => data.prepare(userId, operationId));
  const repeated = await call(() => data.prepare(userId, operationId)); assert.equal(repeated.receiptToken, prepared.receiptToken);
  if (authFixture.verifyPassword) assert.equal(await authFixture.verifyPassword(authFixture.password), true);
  await call(() => data.execute(userId, { operationId, receiptToken: prepared.receiptToken, confirmation: "永久刪除我的帳戶", password: authFixture.password }));
  const status = await call(() => data.status(operationId, prepared.receiptToken));
  assert.deepEqual(status, { operationId, state: "completed", attachmentsPending: false });
  assert.deepEqual(await call(() => data.status(operationId, prepared.receiptToken)), status);
  assert.equal((await pool.query('SELECT 1 FROM "user" WHERE id=$1', [userId])).rowCount, 0);
  assert.equal((await pool.query("SELECT 1 FROM auth_mail_outbox WHERE user_id=$1", [userId])).rowCount, 0);
  return { fixture: { userId, childId: child.id, recordId: record.id, messageId: message.id, documentId: document.id, operationId }, calls,
    checks: { completeAllowlistedDownload: true, sourceContentPresent: true, otherIdentityRejected: true, childErased: true, accountErased: true, originalReceiptRecovered: true, nativePasswordVerified: Boolean(authFixture.verifyPassword) }, coverage };
}
