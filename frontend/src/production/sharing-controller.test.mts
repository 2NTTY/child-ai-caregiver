import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createSharingApi } from "../../../src/client/sharing-api.ts";
import type { SharedSpaceView, SharingCommand, SharingOperation } from "../../../src/shared/sharing-control.ts";
import { SharingController } from "./SharingController.ts";
import { isProductionRouteConnected } from "./routes.ts";
import { sharedRouteMessage, sharedRouteModules } from "./shared-route-access.ts";

test("teacher spaces open attached classes and retain original detach receipts through identity cleanup", async () => {
  const team: SharedSpaceView = { id: randomUUID(), kind: "teachers", name: "Teachers", role: "owner", managerUserId: "teacher",
    transferTargetUserId: null, version: 3, createdAt: "2026-10-28T00:00:00Z", updatedAt: "2026-10-28T00:00:00Z" };
  const otherTeam = { ...team, id: randomUUID(), name: "Second team" };
  let classroom: SharedSpaceView = { ...team, id: randomUUID(), kind: "class", name: "Class A", teacherSpaceId: team.id,
    teacherSpaceName: team.name, teacherSpaceVersion: team.version, detachTargetUserId: null };
  const childId = randomUUID(), requests: string[] = [], commands: SharingCommand[] = [];
  assert.equal(isProductionRouteConnected("/teachers"), true);
  assert.equal(sharedRouteModules("/teachers"), null, "Teacher management has no child module prerequisite");
  const unselected = { identityKey: "teacher:1", userId: "teacher", online: true, target: null, view: null, phase: "none" as const, error: null };
  assert.equal(sharedRouteMessage(unselected, "/teachers"), null);
  assert.equal(sharedRouteMessage({ ...unselected, target: { spaceId: classroom.id, childId }, phase: "error", error: "Grant unavailable" }, "/teachers"), null);
  let receipt: SharingOperation | null = null;
  const api = createSharingApi("https://example.test", async (input, init) => {
    const url = new URL(String(input)); requests.push(url.pathname + url.search);
    if (url.pathname.endsWith("/commands")) {
      const command = JSON.parse(String(init?.body)) as SharingCommand; commands.push(command);
      assert.equal(command.action, "detachClass");
      classroom = { ...classroom, version: 4, teacherSpaceId: null, detachTargetUserId: null };
      receipt = { operationId: command.operationId, action: command.action, space: classroom };
      throw new Error("Lost committed detach response");
    }
    if (url.pathname.includes("/operations/")) return Response.json({ operation: receipt });
    if (url.pathname.endsWith("/teachers")) return Response.json({ items: url.searchParams.has("cursor") ? [otherTeam] : [team], nextCursor: url.searchParams.has("cursor") ? null : "teams_2" });
    if (url.pathname.endsWith("/classes")) return Response.json({ items: classroom.teacherSpaceId ? [classroom] : [], nextCursor: null });
    if (url.pathname.endsWith("/roster")) return Response.json({ items: [{ childId, childName: "Amy", modules: ["profile"], sharedBy: "teacher", version: 1, canWithdraw: false }], nextCursor: null });
    if (url.pathname.endsWith("/members") || url.pathname.endsWith("/invitations")) return Response.json({ items: [], nextCursor: null });
    assert.ok(!url.pathname.endsWith("/shares"), "Teacher spaces must not read personal module shares");
    return Response.json(url.pathname.endsWith(team.id) ? team : classroom);
  });
  const controller = new SharingController(api, "teachers"); controller.syncContext("teacher", "teacher:1", true);
  try {
    await controller.loadSpaces(); await controller.loadSpaces(true);
    assert.deepEqual(controller.getSnapshot().spaces.items, [team, otherTeam]);
    await controller.selectSpace(team.id);
    assert.deepEqual(controller.getSnapshot().teacherClasses.items, [classroom]);
    await controller.selectSpace(classroom.id);
    assert.equal(controller.getSnapshot().selected?.id, classroom.id);
    assert.equal(controller.getSnapshot().shares.items[0]?.childId, childId);
    assert.ok(!requests.includes(`/api/shared-spaces/${classroom.id}/invitations`));
    await controller.loadTeacherSpaces(); await controller.loadTeacherSpaces(true);
    assert.deepEqual(controller.getSnapshot().teacherSpaces.items, [team, otherTeam]);
    const detach: SharingCommand = { action: "detachClass", operationId: randomUUID(), spaceId: classroom.id,
      expectedVersion: classroom.version, expectedTeacherVersion: team.version, targetUserId: "teacher" };
    await controller.submit(detach); await controller.retryOriginal();
    assert.deepEqual(commands, [detach]); assert.equal(controller.getSnapshot().pending?.command.operationId, detach.operationId);
    await controller.checkOriginal();
    assert.equal(controller.getSnapshot().pending, null); assert.equal(controller.getSnapshot().selected?.teacherSpaceId, null);
    assert.equal(controller.getSnapshot().receipt?.operationId, detach.operationId);
    controller.syncContext("other", "other:2", true);
    assert.deepEqual(controller.getSnapshot().teacherClasses.items, []); assert.deepEqual(controller.getSnapshot().teacherSpaces.items, []);
    assert.equal(controller.getSnapshot().receipt, null); assert.equal(controller.getSnapshot().selected, null);
  } finally { controller.dispose(); }
});

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

test("class management preserves original add commands and query-bound roster continuation across identity cleanup", async () => {
  const space: SharedSpaceView = { id: randomUUID(), kind: "class", name: "Class A", role: "owner", managerUserId: "teacher",
    transferTargetUserId: null, version: 1, createdAt: "2026-10-28T00:00:00Z", updatedAt: "2026-10-28T00:00:00Z" };
  const childId = randomUUID(), commands: SharingCommand[] = [], rosterRequests: URL[] = [];
  let receipt: SharingOperation | null = null, hold = false, release!: (response: Response) => void, heldSignal: AbortSignal | undefined;
  const api = createSharingApi("https://example.test", async (input, init) => {
    const url = new URL(String(input));
    assert.equal(new Headers(init?.headers).get("x-expected-user-id"), "teacher");
    if (url.pathname.endsWith("/commands")) {
      const command = JSON.parse(String(init?.body)) as SharingCommand; commands.push(command);
      receipt = { operationId: command.operationId, action: command.action, space: command.action === "acceptInvitation" ? { ...space, id: randomUUID(), kind: "family" } : space,
        ...(command.action === "addClassChild" ? { childId } : {}) };
      if (command.action === "addClassChild") throw new Error("Lost accepted add response");
      return Response.json(receipt);
    }
    if (url.pathname.includes("/operations/")) return Response.json({ operation: receipt });
    if (url.pathname.endsWith("/classes")) return Response.json({ items: [space], nextCursor: null });
    if (url.pathname.endsWith("/roster")) {
      rosterRequests.push(url);
      if (hold) { heldSignal = init?.signal ?? undefined; return new Promise<Response>(resolve => { release = resolve; }); }
      if (url.searchParams.get("query") === "amy" && !url.searchParams.has("cursor")) return Response.json({ items: [], nextCursor: "amy_page_2" });
      if (url.searchParams.has("cursor")) {
        assert.equal(url.searchParams.get("cursor"), "amy_page_2"); assert.equal(url.searchParams.get("query"), "amy");
        return Response.json({ items: [{ childId, childName: "Amy", modules: ["profile"], sharedBy: "teacher", version: 1, canWithdraw: false }], nextCursor: null });
      }
      return Response.json({ items: [], nextCursor: null });
    }
    if (url.pathname.endsWith("/members") || url.pathname.endsWith("/invitations")) return Response.json({ items: [], nextCursor: null });
    assert.equal(url.pathname, "/api/shared-spaces/" + space.id);
    return Response.json(space);
  });
  const controller = new SharingController(api, "class"); controller.syncContext("teacher", "teacher:1", true);
  try {
    await controller.loadSpaces(); assert.deepEqual(controller.getSnapshot().spaces.items, [space]);
    await controller.submit({ action: "create", operationId: randomUUID(), kind: "class", name: space.name });
    assert.equal(controller.getSnapshot().selected?.kind, "class");
    const add: SharingCommand = { action: "addClassChild", operationId: randomUUID(), spaceId: space.id, expectedVersion: 1, displayName: "Amy" };
    await controller.submit(add); await controller.retryOriginal();
    assert.equal(commands.length, 2); assert.equal(controller.getSnapshot().pending?.command.operationId, add.operationId);
    await controller.searchRoster("Must not replace pending query"); assert.equal(controller.getSnapshot().rosterQuery, "");
    await controller.checkOriginal(); assert.equal(commands.length, 2); assert.equal(controller.getSnapshot().receipt?.childId, childId);
    await controller.searchRoster("Amy");
    assert.equal(controller.getSnapshot().rosterQuery, "Amy"); assert.deepEqual(controller.getSnapshot().shares.items, []);
    assert.equal(controller.getSnapshot().rosterLoaded, true);
    assert.equal(controller.getSnapshot().shares.nextCursor, "amy_page_2");
    await controller.more("shares"); assert.equal(controller.getSnapshot().shares.items[0]?.childId, childId);
    await controller.searchRoster("Bob"); assert.deepEqual(controller.getSnapshot().shares.items, []);
    assert.equal(rosterRequests.at(-1)?.searchParams.has("cursor"), false); assert.equal(rosterRequests.at(-1)?.searchParams.get("query"), "bob");
    const rosterCount = rosterRequests.length;
    await controller.submit({ action: "acceptInvitation", operationId: randomUUID(), token: "t".repeat(43) });
    assert.equal(controller.getSnapshot().receipt?.space?.kind, "family"); assert.equal(controller.getSnapshot().selected, null);
    assert.equal(controller.getSnapshot().pending, null); assert.equal(rosterRequests.length, rosterCount);
    assert.match(controller.getSnapshot().notice!, /家庭管理/u);
    await controller.selectSpace(space.id);
    hold = true; const reading = controller.searchRoster("Amy");
    controller.syncContext("other", "other:2", true); assert.equal(heldSignal?.aborted, true);
    release(Response.json({ items: [], nextCursor: "old_identity" })); await reading;
    assert.equal(controller.getSnapshot().rosterQuery, ""); assert.equal(controller.getSnapshot().rosterLoaded, false);
    assert.deepEqual(controller.getSnapshot().shares, { items: [], nextCursor: null });
    assert.equal(controller.getSnapshot().pending, null); assert.equal(controller.getSnapshot().receipt, null); assert.equal(controller.getSnapshot().selected, null);
  } finally { controller.dispose(); }
});
