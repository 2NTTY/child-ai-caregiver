import { createHash } from 'node:crypto';
import { fetchPublicSourceResponse } from './public-source-transport.ts';
import { parsePersonalPage } from './personal-source-fetch.ts';
import { KNOWLEDGE_PDF_MAX_BYTES } from './knowledge-pdf.ts';
import { sourceFileOriginal, type SourceCardOriginal } from './source-card-original.ts';
import { inspectSourcePage, sourceCardScope, type SourceCardInput, type UserAction } from './source-card-page.ts';
import { renderSourceCard, type RenderResource } from './source-card-render-client.ts';
import { loginSourceCard, siteCookieJar, type SourceCardCredential } from './source-card-login.ts';

export type { SourceCardInput, SourceCardOriginal };
interface BoundSiteSession { cardId: string; origin: string; cookie?: string; authorization?: string }
export interface SourceCardAccess {
  authorize(cardId: string): Promise<boolean>;
  readSession?(cardId: string, origin: string): Promise<BoundSiteSession | null>;
  credentialFor?(cardId: string): Promise<SourceCardCredential | null>;
}
type Failure = 'scope' | 'authorization' | 'limit' | 'unavailable' | 'unreadable';
export type SourceCardResult = { status: 'ok'; originals: SourceCardOriginal[] }
  | { status: 'needs_user'; reason: UserAction } | { status: 'failed'; reason: Failure };
type Reply = { url: string; mime: string; body: Buffer };

export async function acquireSourceCard(input: SourceCardInput, access: SourceCardAccess, outer: AbortSignal): Promise<SourceCardResult> {
  const signal = AbortSignal.any([outer, AbortSignal.timeout(90_000)]);
  let failure: Failure = 'unavailable';
  function fail(reason: Failure): never { failure = reason; throw Error(reason); }
  let gate: UserAction | null = null;
  let bound: SourceCardCredential | undefined;
  let established: BoundSiteSession | null = null;
  function needsUser(reason: UserAction): never { gate = reason; throw Error('needs_user'); }
  async function current() {
    if (signal.aborted) fail('unavailable');
    if (!await access.authorize(input.cardId)) fail('authorization');
    if (bound) {
      const fresh = await access.credentialFor?.(input.cardId);
      if (!fresh || fresh.origin !== bound.origin || fresh.username !== bound.username || fresh.password !== bound.password) fail('authorization');
    }
    if (established) {
      const fresh = await access.readSession?.(input.cardId, established.origin);
      if (!fresh || fresh.cardId !== established.cardId || fresh.origin !== established.origin ||
          fresh.authorization !== established.authorization || fresh.cookie !== established.cookie) fail('authorization');
    }
    signal.throwIfAborted();
  }
  try {
    await current();
    let scope: ReturnType<typeof sourceCardScope>;
    try { scope = sourceCardScope(input); } catch { return { status: 'failed', reason: 'scope' }; }
    const check = (value: string) => { try { return scope(value); } catch { return fail('scope'); } };
    const inScope = (value: string) => { try { return scope(value).href; } catch { return null; } };
    const entry = check(input.entryUrl), cache = new Map<string, Reply>(), queue = [entry.href], visited = new Set<string>();
    const originals = new Map<string, SourceCardOriginal>();
    const secrets = new Set<string>();
    const jar = siteCookieJar(entry.origin, secrets);
    if (!input.login && access.readSession) {
      const session = await access.readSession(input.cardId, entry.origin);
      if (session) {
        if (session.origin !== entry.origin || session.cardId !== input.cardId) fail('authorization');
        established = { ...session };
      }
    }
    if (input.login) {
      const credentials = await access.credentialFor?.(input.cardId);
      if (!credentials) needsUser('login');
      if (credentials.origin !== entry.origin || !credentials.username || !credentials.password ||
          credentials.username.length > 1024 || credentials.password.length > 4096) fail('authorization');
      bound = { ...credentials };
      secrets.add(bound.password);
      let loginGate;
      try { loginGate = await loginSourceCard(input.login, entry.origin, bound, jar, current, signal); }
      catch (e) { if (e instanceof Error && ['scope','personal_source_url_rejected'].includes(e.message)) fail('scope'); throw e; }
      if (loginGate) needsUser(loginGate);
    }
    let remaining = 40 * 1024 * 1024, gets = 0, pages = 0;
    const sessionForGet = async (url: URL) => {
      await current();
      if (++gets > 48) fail('limit');
      const session = bound ? { cardId: input.cardId, origin: entry.origin, cookie: jar.header(url), authorization: undefined }
        : established;
      if (!session) return {};
      if (session.origin !== entry.origin || session.cardId !== input.cardId ||
          [session.cookie, session.authorization].some(v => v !== undefined && (typeof v !== 'string' || v.length > 8192 || /[\u0000-\u001f\u007f]/u.test(v)))) fail('authorization');
      for (const part of session.cookie?.split(';') ?? []) {
        if (!part) continue;
        const split = part.indexOf('=');
        if (split < 1) fail('authorization');
        const value = part.slice(split + 1).trim();
        if (value) secrets.add(value);
      }
      const auth = session.authorization?.split(/\s+/u).at(-1);
      if (auth) secrets.add(auth);
      if (secrets.size > 64) fail('limit');
      if ([...secrets].some(v => decodeURIComponent(url.pathname + url.search).includes(v))) fail('authorization');
      await current();
      return { cookie: session.cookie, authorization: session.authorization };
    };
    async function read(url: string, asset = false): Promise<Reply> {
      await current();
      const hit = cache.get(url);
      if (hit) return hit;
      if (remaining <= 0) fail('limit');
      const got = await fetchPublicSourceResponse(url, value => {
        if (value !== url) {
          const target = new URL(value);
          if (/\b(?:captcha)\b/iu.test(target.pathname)) needsUser('captcha');
          if (/\b(?:mfa|otp|2fa|verification)\b/iu.test(target.pathname)) needsUser('mfa');
          if (/\b(?:checkout|paywall|purchase)\b/iu.test(target.pathname)) needsUser('purchase');
          if (/\b(?:login|sign-?in|oauth2?)\b/iu.test(target.pathname)) needsUser('login');
        }
        return check(value);
      }, signal, '*/*', {
        maxBytes: Math.min(remaining, asset ? 2 * 1024 * 1024 : KNOWLEDGE_PDF_MAX_BYTES), sessionForGet,
        receiveCookies: bound ? jar.receive : undefined, readGateBody: true });
      if (got.status !== 'response') throw Error('transport');
      await current();
      const { status, contentType, body } = got.response;
      if (status === 401 || status === 403 || status === 429) {
        const gate = /^text\/html(?:;|$)/iu.test(contentType) && inspectSourcePage(body.toString('utf8'), url).gate;
        if (gate) needsUser(gate);
        if (status !== 429) needsUser('login');
      }
      if (status === 402) needsUser('purchase');
      if (status !== 200) fail('unavailable');
      const finalUrl = check(got.response.url ?? url).href;
      if ([...secrets].some(v => body.includes(Buffer.from(v)) || decodeURIComponent(finalUrl).includes(v))) fail('authorization');
      const value = { url: finalUrl, mime: contentType.split(';')[0]!.trim().toLowerCase(), body };
      remaining -= body.length;
      cache.set(url, value); cache.set(finalUrl, value);
      return value;
    }
    const add = (original: SourceCardOriginal) => {
      originals.set(original.url, original);
      if (originals.size > 16) fail('limit');
    };
    const enqueue = (value: string) => {
      const url = inScope(value);
      if (!url || visited.has(url) || queue.includes(url)) return;
      if (visited.size + queue.length >= 32) fail('limit');
      queue.push(url);
    };
    async function file(reply: Reply) {
      try { return await sourceFileOriginal(reply.url, reply.mime, reply.body, signal); }
      catch { return fail('unreadable'); }
    }
    while (queue.length) {
      const url = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);
      const reply = await read(url);
      if (url !== reply.url && visited.has(reply.url)) continue;
      visited.add(reply.url);
      if (reply.mime !== 'text/html') {
        const original = await file(reply);
        if (!original) fail('unreadable');
        add(original); continue;
      }
      if (++pages > 8 || reply.body.length > 1024 * 1024) fail('limit');
      let html: string;
      try { html = new TextDecoder('utf-8', { fatal: true }).decode(reply.body); } catch { return fail('unreadable'); }
      const page = inspectSourcePage(html, reply.url);
      if (page.gate) needsUser(page.gate);
      const children = input.kind === 'document' ? [] : page.links.map(inScope).filter((u): u is string => !!u && u !== reply.url);
      for (const link of children) enqueue(link);
      if (page.dynamic && input.kind !== 'document') {
        const snapshot = new Map<string, RenderResource>();
        const include = (key: string, r: Reply) => { snapshot.set(key, { url: key, mime: r.mime, body: r.body.toString('base64') }); };
        include(reply.url, reply);
        const attempted = new Set<string>();
        let found = false;
        for (let pass = 0; ; pass++) {
          if (pass >= 6) fail('limit');
          await current();
          const rendered = await renderSourceCard({ url: reply.url, resources: [...snapshot.values()] }, signal);
          if (rendered.gate) needsUser(rendered.gate);
          if (rendered.limited) fail('limit');
          for (const link of rendered.links) {
            if (inScope(link) && link !== reply.url) { enqueue(link); found = true; }
          }
          let changed = false;
          for (const hint of rendered.assets) {
            const key = inScope(hint);
            if (!key || attempted.has(key)) continue;
            attempted.add(key);
            if (attempted.size > 24) fail('limit');
            const item = await read(key);
            if (/^(?:(?:application|text)\/(?:javascript|ecmascript|json)|text\/html|application\/[a-z0-9.+-]+\+json)$/u.test(item.mime)) {
              if (item.body.length > 1024 * 1024) fail('limit');
              include(key, item); changed = true;
            } else {
              const original = await file(item);
              if (!original) fail('unreadable');
              add(original); found = true;
            }
          }
          if (!changed) {
            if (rendered.unresolved) fail('unreadable');
            break;
          }
        }
        if (!found && !children.length) fail('unreadable');
      } else if (!children.length) {
        let content;
        try { content = parsePersonalPage(html, reply.url); } catch { return fail('unreadable'); }
        add({ url: reply.url, mimeType: 'text/html', bytes: reply.body,
          sha256: createHash('sha256').update(reply.body).digest('hex'), preview: content.text.slice(0,12000) });
      }
    }
    await current();
    return originals.size ? { status: 'ok', originals: [...originals.values()] } : { status: 'failed', reason: 'unreadable' };
  } catch {
    if (gate && !signal.aborted) {
      try { await current(); return { status: 'needs_user', reason: gate }; } catch { /* Authorization or cancellation wins. */ }
    }
    return { status: 'failed', reason: failure };
  }
}
