import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createSharingApi } from "../../../src/client/sharing-api.ts";
import type { SharedSpaceView, SharingCommand, SharingOperation } from "../../../src/shared/sharing-control.ts";
import { SharingController } from "./SharingController.ts";

test("sharing management keeps original unknown commands, bounded pages and identity cleanup through the authenticated client", async () => {
  const space = (name: string): SharedSpaceView => ({ id: randomUUID(), kind: "family", name, role: "owner", managerUserId: "parent",
    transferTargetUserId: null, version: 1, createdAt: "2026-10-27T00:00:00Z", updatedAt: "2026-10-27T00:00:00Z" });
  const first = space("First"), second = space("Second"), created = space("Created"), fresh = space("After conflict"), token = "t".repeat(43);
  let duplicate = true, writes = 0, lookups = 0, hold = false, release!: (response: Response) => void, heldSignal: AbortSignal | undefined;
  let committed: SharingOperation | null = null;
  let staleOperationId: string | null = null, stalePosts = 0;
  const commands: SharingCommand[] = [], requests: string[] = [];
  const api = createSharingApi("https://example.test", async (input, init) => {
    const url = new URL(String(input)), actor = new Headers(init?.headers).get("x-expected-user-id"); requests.push(url.pathname + url.search);
    assert.equal(init?.credentials, "include"); assert.equal(init?.cache, "no-store"); assert.ok(init?.signal);
    if (actor === "other") return Response.json({ items: [], nextCursor: null });
    assert.equal(actor, "parent");
    if (url.pathname.endsWith("/commands")) {
      assert.equal(init?.method, "POST"); const command = JSON.parse(String(init?.body)) as SharingCommand; commands.push(command); writes++;
      if (command.operationId === staleOperationId) {
        if (++stalePosts === 1) throw new Error("Lost stale command response");
        first.version++;
        return Response.json({ error: { code: "version_conflict" } }, { status: 409 });
      }
      if (command.action === "create") {
        if (writes === 1) return Response.json({ error: { code: "identity_changed" } }, { status: 409 });
        committed = { operationId: command.operationId, action: command.action, space: command.name === fresh.name ? fresh : created }; return Response.json(committed);
      }
      if (command.action === "leave") {
        committed = { operationId: command.operationId, action: command.action, space: null, redacted: true };
        throw new Error("Lost accepted exit response");
      }
      assert.equal(command.action, "invite"); created.version++;
      committed = { operationId: command.operationId, action: command.action, space: created, invitationToken: token };
      throw new Error("Lost accepted invite response");
    }
    if (url.pathname.includes("/operations/")) {
      if (url.pathname.endsWith("/" + staleOperationId)) return Response.json({ operation: null });
      lookups++;
      if (lookups === 2) return Response.json({ error: { code: "space_access_denied" } }, { status: 403 });
      return Response.json({ operation: lookups === 1 ? null : lookups === 3 ? { ...committed, action: "share" } : committed });
    }
    assert.equal(init?.method, "GET");
    if (url.pathname === "/api/shared-spaces") {
      if (hold) { heldSignal = init?.signal ?? undefined; return new Promise<Response>(resolve => { release = resolve; }); }
      if (url.searchParams.has("cursor")) { assert.equal(url.searchParams.get("cursor"), "page_2"); return Response.json({ items: [duplicate ? first : second], nextCursor: null }); }
      return Response.json({ items: [first], nextCursor: "page_2" });
    }
    if (url.pathname.endsWith("/members")) return Response.json({ items: [{ userId: "parent", label: "Synthetic", role: "owner", version: 1, joinedAt: first.createdAt }], nextCursor: null });
    if (url.pathname.endsWith("/shares") || url.pathname.endsWith("/invitations")) return Response.json({ items: [], nextCursor: null });
    return Response.json(url.pathname.endsWith(created.id) ? created : url.pathname.endsWith(fresh.id) ? fresh : first);
  });
  const controller = new SharingController(api); controller.syncContext("parent", "parent:1", true);
  try {
    await controller.loadSpaces(); assert.deepEqual(controller.getSnapshot().spaces.items, [first]);
    await controller.loadSpaces(true); assert.equal(controller.getSnapshot().spaces.items.length, 1); assert.match(controller.getSnapshot().notice!, /未能核對/u);
    duplicate = false; await controller.loadSpaces(true); assert.deepEqual(controller.getSnapshot().spaces.items, [first, second]);
    const command: SharingCommand = { action: "create", operationId: randomUUID(), name: "Created", kind: "family" };
    await controller.submit(command); assert.equal(controller.getSnapshot().pending?.command.operationId, command.operationId);
    const before = requests.length;
    await controller.submit({ ...command, operationId: randomUUID(), name: "Must not create" }); await controller.retryOriginal();
    assert.equal(requests.length, before);
    await controller.checkOriginal(); assert.equal(controller.getSnapshot().pending?.checked, true);
    await controller.retryOriginal(); assert.deepEqual(commands.slice(0, 2), [command, command]); assert.equal(controller.getSnapshot().pending, null);
    assert.equal(controller.getSnapshot().selected?.id, created.id);
    const invite: SharingCommand = { action: "invite", operationId: randomUUID(), spaceId: created.id, expectedVersion: created.version,
      email: "synthetic@example.test", role: "viewer", expiresAt: "2026-11-01T00:00:00Z" };
    await controller.submit(invite); await controller.checkOriginal();
    assert.equal(controller.getSnapshot().pending?.command.operationId, invite.operationId); assert.equal(controller.getSnapshot().selected, null);
    await controller.checkOriginal(); assert.equal(controller.getSnapshot().pending?.command.operationId, invite.operationId);
    assert.equal(controller.getSnapshot().invitationToken, null); assert.equal(controller.getSnapshot().pending?.checked, false);
    await controller.checkOriginal();
    assert.equal(writes, 3); assert.equal(controller.getSnapshot().invitationToken, token); assert.equal(controller.getSnapshot().pending, null);
    hold = true; const reading = controller.loadSpaces();
    controller.syncContext("other", "other:2", true); assert.equal(heldSignal?.aborted, true);
    release(Response.json({ items: [first], nextCursor: null })); await reading;
    assert.equal(controller.getSnapshot().invitationToken, null); assert.equal(controller.getSnapshot().receipt, null);
    assert.equal(controller.getSnapshot().selected, null); assert.deepEqual(controller.getSnapshot().spaces.items, []);
    await controller.loadSpaces(); assert.equal(controller.getSnapshot().userId, "other"); assert.deepEqual(controller.getSnapshot().spaces.items, []);
    hold = false; controller.syncContext("parent", "parent:3", true);
    const exit: SharingCommand = { action: "leave", operationId: randomUUID(), spaceId: created.id, expectedVersion: created.version };
    await controller.submit(exit); await controller.checkOriginal();
    assert.equal(controller.getSnapshot().pending, null); assert.equal(controller.getSnapshot().receipt?.redacted, true);
    assert.equal(controller.getSnapshot().notice, "原操作已完成，目前無權讀取詳情。"); assert.equal(controller.getSnapshot().invitationToken, null);
    assert.equal(writes, 4);
    await controller.selectSpace(first.id);
    const stale: SharingCommand = { ...invite, operationId: randomUUID(), spaceId: first.id, expectedVersion: first.version };
    staleOperationId = stale.operationId;
    await controller.submit(stale); await controller.checkOriginal();
    assert.equal(controller.getSnapshot().pending?.checked, true);
    await controller.retryOriginal();
    assert.deepEqual(commands.slice(-2), [stale, stale]);
    assert.equal(controller.getSnapshot().pending, null, "A receipt-first version conflict proves the original command had no effect");
    assert.match(controller.getSnapshot().notice!, /重新讀取.*核對/u);
    await controller.refreshSelected(); assert.equal(controller.getSnapshot().selected?.version, first.version);
    const next: SharingCommand = { action: "create", operationId: randomUUID(), kind: "family", name: fresh.name };
    await controller.submit(next);
    assert.equal(controller.getSnapshot().pending, null); assert.equal(controller.getSnapshot().receipt?.operationId, next.operationId);
    assert.equal(controller.getSnapshot().selected?.id, fresh.id); assert.equal(writes, 7);
    assert.equal(requests.some(path => path.includes("/children")), false, "Identity-level create and invitation flows must not require a child");
  } finally { controller.dispose(); }
});
