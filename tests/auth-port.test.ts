import assert from "node:assert/strict";
import type { IncomingHttpHeaders } from "node:http";
import test from "node:test";
import { fromNodeHeaders } from "better-auth/node";
import { createBetterAuthPort } from "../server/auth.ts";
import type { ServerAuthSession, ServerAuthSessionWithHeaders } from "../server/auth-port.ts";

test("Better Auth port preserves raw session, request, response, headers and refreshed cookies", async () => {
  const session = {
    user: { id: "owner", email: "synthetic@example.invalid", providerField: "preserved" },
    session: { token: "synthetic-session", expiresAt: new Date("2026-10-10T00:00:00Z") },
    providerField: { version: 1 },
  };
  const cookies = [
    "better-auth.session_token=synthetic-renewed; Expires=Wed, 14 Oct 2026 00:00:00 GMT; Path=/; HttpOnly; SameSite=Lax",
    "better-auth.session_data=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
  ];
  const responseHeaders = new Headers();
  for (const cookie of cookies) responseHeaders.append("set-cookie", cookie);
  const rawSessionResult = { response: session, headers: responseHeaders, providerField: "preserved" };
  const requestHeaders = new Headers({ cookie: "better-auth.session_token=synthetic-session" });
  const request = new Request("http://localhost:3001/api/auth/get-session", { headers: requestHeaders });
  const rawResponse = new Response("synthetic-response", { headers: responseHeaders });
  const calls: unknown[] = [];
  function getSession(options: { headers: Headers; returnHeaders?: false }): Promise<ServerAuthSession | null>;
  function getSession(options: { headers: Headers; returnHeaders: true }): Promise<ServerAuthSessionWithHeaders>;
  async function getSession(options: { headers: Headers; returnHeaders?: boolean }): Promise<ServerAuthSession | null | ServerAuthSessionWithHeaders> {
    calls.push(options);
    assert.equal(options.headers, requestHeaders);
    return options.returnHeaders === true ? rawSessionResult : session;
  }
  const port = createBetterAuthPort({
    handler: async actual => { assert.equal(actual, request); return rawResponse; },
    api: { getSession },
  });
  const omitted = { headers: requestHeaders };
  const disabled = { headers: requestHeaders, returnHeaders: false as const };
  const enabled = { headers: requestHeaders, returnHeaders: true as const };
  assert.equal(await port.getSession(omitted), session);
  assert.equal(await port.getSession(disabled), session);
  const result = await port.getSession(enabled);
  assert.equal(result, rawSessionResult);
  assert.equal(result.response, session);
  assert.equal(result.headers, responseHeaders);
  assert.deepEqual(result.headers.getSetCookie(), cookies);
  assert.equal(calls[0], omitted);
  assert.equal(calls[1], disabled);
  assert.equal(calls[2], enabled);
  assert.equal(calls.length, 3);
  assert.equal(await port.handler(request), rawResponse);
  assert.deepEqual(rawResponse.headers.getSetCookie(), cookies);
});

test("Better Auth port preserves null sessions and every expiry cookie", async () => {
  const cookies = [
    "better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
    "better-auth.session_data=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
  ];
  const headers = new Headers();
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  const rawResult = { response: null, headers, providerField: "preserved" };
  function getSession(options: { headers: Headers; returnHeaders?: false }): Promise<ServerAuthSession | null>;
  function getSession(options: { headers: Headers; returnHeaders: true }): Promise<ServerAuthSessionWithHeaders>;
  async function getSession(options: { headers: Headers; returnHeaders?: boolean }): Promise<ServerAuthSession | null | ServerAuthSessionWithHeaders> {
    return options.returnHeaders === true ? rawResult : null;
  }
  const port = createBetterAuthPort({ handler: async () => Response.json(null), api: { getSession } });
  const requestHeaders = new Headers();
  assert.equal(await port.getSession({ headers: requestHeaders }), null);
  assert.equal(await port.getSession({ headers: requestHeaders, returnHeaders: false }), null);
  const result = await port.getSession({ headers: requestHeaders, returnHeaders: true });
  assert.equal(result, rawResult);
  assert.equal(result.headers, headers);
  assert.deepEqual(result.headers.getSetCookie(), cookies);
});

test("Better Auth port delegates the native pure Node header helper", () => {
  const unused = async (): Promise<never> => { throw new Error("Unexpected authentication call"); };
  const port = createBetterAuthPort({ handler: unused, api: { getSession: unused } });
  assert.equal(port.fromNodeHeaders, fromNodeHeaders);
  const nodeHeaders: IncomingHttpHeaders = {
    cookie: "better-auth.session_token=synthetic-session", "x-example": ["first", "second"], omitted: undefined,
  };
  const expected = fromNodeHeaders(nodeHeaders);
  const actual = port.fromNodeHeaders(nodeHeaders);
  assert.deepEqual([...actual], [...expected]);
  actual.set("cookie", "synthetic-replacement");
  assert.deepEqual(nodeHeaders, {
    cookie: "better-auth.session_token=synthetic-session", "x-example": ["first", "second"], omitted: undefined,
  });
});

test("Better Auth port propagates the original provider error without retries or null conversion", async () => {
  const providerError = new Error("synthetic-private-provider-error");
  let sessionCalls = 0, handlerCalls = 0;
  const port = createBetterAuthPort({
    handler: async () => { handlerCalls += 1; throw providerError; },
    api: { getSession: async () => { sessionCalls += 1; throw providerError; } },
  });
  const sameError = (error: unknown) => { assert.equal(error, providerError); return true; };
  const headers = new Headers();
  await assert.rejects(port.getSession({ headers }), sameError);
  await assert.rejects(port.getSession({ headers, returnHeaders: false }), sameError);
  await assert.rejects(port.getSession({ headers, returnHeaders: true }), sameError);
  await assert.rejects(port.handler(new Request("http://localhost:3001/api/auth/get-session")), sameError);
  assert.equal(sessionCalls, 3);
  assert.equal(handlerCalls, 1);
});
