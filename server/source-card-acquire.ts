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
type Failure = 'scope' | 'authorization' | 'limit' | 'file_too_large' | 'listing_changed' | 'unavailable' | 'unreadable';
export type SourceCardResult = { status: 'ok'; originals: SourceCardOriginal[] }
  | { status: 'needs_user'; reason: UserAction } | { status: 'failed'; reason: Failure };
type Reply = { url: string; mime: string; body: Buffer };
export interface SourceCardWorkItem { url: string; offset?: number; listingHash?: string }
export interface SourceCardBatchWork { revision: number; checkId: string; items: SourceCardWorkItem[] }
export type SourceCardBatchResult = Exclude<SourceCardResult, { status: 'ok' }> |
  { status: 'ok'; originals: SourceCardOriginal[]; consumed: number; next: SourceCardWorkItem[] };
const listingWindow = 16;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const mimeType = (header: string) => header.split(';')[0]!.trim().toLowerCase();
const snapshotType = (mime: string) => /^(?:(?:application|text)\/(?:javascript|ecmascript|json)|text\/html|application\/[a-z0-9.+-]+\+json)$/u.test(mime);

export async function acquireSourceCard(input: SourceCardInput, access: SourceCardAccess, outer: AbortSignal): Promise<SourceCardResult> {
  const result = await runAcquisition(input, access, outer);
  return result.status === 'ok' ? { status: 'ok', originals: result.originals } : result;
}

/**
 * The owner commits originals, newly discovered items and the consumed prefix together
 * under the same card revision/check lease. A file_too_large result applies to items[0].
 * A listing_changed result invalidates that cursor for this check.
 */
export async function acquireSourceCardBatch(input: SourceCardInput, access: SourceCardAccess, signal: AbortSignal, work: SourceCardBatchWork): Promise<SourceCardBatchResult> {
  if (!work || !Number.isSafeInteger(work.revision) || work.revision < 1 || typeof work.checkId !== 'string' ||
      !work.checkId.length || work.checkId.length > 128 || !Array.isArray(work.items) || !work.items.length || work.items.length > 8 ||
      !work.items.every(item => typeof item?.url === 'string' && (item.offset === undefined ? item.listingHash === undefined :
        Number.isSafeInteger(item.offset) && item.offset > 0 && typeof item.listingHash === 'string' && /^[a-f0-9]{64}$/u.test(item.listingHash))))
    return { status: 'failed', reason: 'scope' };
  return runAcquisition(input, access, signal, work);
}
async function runAcquisition(input: SourceCardInput, access: SourceCardAccess, outer: AbortSignal, work?: SourceCardBatchWork): Promise<SourceCardBatchResult> {
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
    const entry = check(input.entryUrl), cache = new Map<string, Reply>(), visited = new Set<string>();
    const queue: SourceCardWorkItem[] = work ? work.items.map(item => ({ ...item, url: check(item.url).href })) : [{ url: entry.href }];
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
    async function read(url: string, discovery = false): Promise<Reply> {
      await current();
      const hit = cache.get(url);
      if (hit) return hit;
      if (remaining <= 0) fail('limit');
      const singleLimit = discovery ? 1024 * 1024 : KNOWLEDGE_PDF_MAX_BYTES;
      const maxBytes = Math.min(remaining, singleLimit);
      let exceededAt = 0;
      const omitBody = discovery ? (header: string) => !snapshotType(mimeType(header)) : undefined;
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
        maxBytes, sessionForGet, omitBody, receiveCookies: bound ? jar.receive : undefined,
        readGateBody: true, onBodyLimit: status => { exceededAt = status; } });
      if (exceededAt) fail(exceededAt === 200 && !discovery && maxBytes === singleLimit ? 'file_too_large' : 'limit');
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
      const value = { url: finalUrl, mime: mimeType(contentType), body };
      remaining -= body.length;
      if (!omitBody?.(contentType)) { cache.set(url, value); cache.set(finalUrl, value); }
      return value;
    }
    const next: SourceCardWorkItem[] = [];
    let consumed = 0;
    const accepted = () => ({ status: 'ok' as const, originals: [...originals.values()], next, consumed });
    const file = async (reply: Reply) => {
      try { return await sourceFileOriginal(reply.url, reply.mime, reply.body, signal); }
      catch (error) { return fail(error instanceof Error && error.message === 'source_file_too_large' ? 'file_too_large' : 'unreadable'); }
    };
    const safeLink = (value: string) => {
      const url = inScope(value);
      if (url && [...secrets].some(secret => decodeURIComponent(url).includes(secret))) fail('authorization');
      return url;
    };
    async function scan(item: SourceCardWorkItem): Promise<{ found: SourceCardOriginal[]; children: SourceCardWorkItem[] }> {
      const reply = await read(item.url);
      const offset = item.offset ?? 0;
      const found: SourceCardOriginal[] = [], children: SourceCardWorkItem[] = [];
      const leaf = { found, children };
      if (!work && item.url !== reply.url && visited.has(reply.url)) return leaf;
      visited.add(reply.url);
      if (reply.mime !== 'text/html') {
        if (offset) fail('listing_changed');
        const original = await file(reply);
        if (!original) fail('unreadable');
        found.push(original); return leaf;
      }
      if (reply.body.length > 1024 * 1024) fail('file_too_large');
      if (++pages > 8) fail('limit');
      let html: string;
      try { html = new TextDecoder('utf-8', { fatal: true }).decode(reply.body); } catch { return fail('unreadable'); }
      const page = inspectSourcePage(html, reply.url);
      if (page.gate) needsUser(page.gate);
      const listing = input.kind === 'document' ? [] : [...new Set(page.links.map(safeLink).filter((url): url is string => !!url && url !== reply.url))];
      const dynamic = input.kind !== 'document' && page.dynamic;
      const listingHash = work ? digest([input.cardId, work.revision, work.checkId, input.kind, entry.href, input.allowedPath ?? null,
        reply.url, listing, dynamic]) : '';
      if (work && offset <= listing.length && offset > 0 && item.listingHash !== listingHash) fail('listing_changed');
      if (work && offset > listing.length && !dynamic) fail('listing_changed');
      if (listing.length && (!work || offset < listing.length)) {
        const end = work ? Math.min(offset + listingWindow, listing.length) : listing.length;
        children.push(...listing.slice(offset, end).map(url => ({ url })));
        if (work) {
          if (end < listing.length || dynamic) children.push({ url: item.url, offset: end, listingHash });
          return leaf;
        }
      }
      if (dynamic) {
        const snapshot = new Map<string, RenderResource>();
        const include = (key: string, r: Reply) => { snapshot.set(key, { url: key, mime: r.mime, body: r.body.toString('base64') }); };
        include(reply.url, reply);
        const attempted = new Set<string>(), discovered = new Set<string>();
        const rendererOffset = work ? offset - listing.length : undefined;
        for (let pass = 0; ; pass++) {
          if (pass >= 6) fail('limit');
          await current();
          const rendered = await renderSourceCard({ url: reply.url, resources: [...snapshot.values()], controlOffset: rendererOffset }, signal);
          if (rendered.gate) needsUser(rendered.gate);
          if (rendered.limited) fail('limit');
          // Only the hydrated result is authoritative. A prior pass can lack the site's scripts or data.
          const links = rendered.links.map(safeLink).filter((url): url is string => !!url && url !== reply.url);
          let changed = false;
          for (const hint of rendered.assets) {
            const key = safeLink(hint);
            if (!key || attempted.has(key)) continue;
            attempted.add(key);
            if (attempted.size > 24) fail('limit');
            const resource = await read(key, !!work);
            if (snapshotType(resource.mime)) {
              if (resource.body.length > 1024 * 1024) fail('limit');
              include(key, resource); changed = true;
            } else if (work) {
              discovered.add(key);
            } else {
              const original = await file(resource);
              if (!original) fail('unreadable');
              found.push(original);
            }
          }
          if (changed) continue;
          if (rendered.unresolved) fail('unreadable');
          if (work) {
            const window = rendered.window;
            if (!window) fail('unavailable');
            if (!window.valid || (rendererOffset && item.listingHash !== digest([listingHash, window.startHash]))) fail('listing_changed');
            if (window.nextOffset !== null) children.push({ url: item.url, offset: listing.length + window.nextOffset,
              listingHash: digest([listingHash, window.endHash]) });
          }
          for (const link of links) discovered.add(link);
          break;
        }
        children.push(...[...discovered].map(url => ({ url })));
        if (!children.length && !found.length && !listing.length && !offset) fail('unreadable');
      } else if (!listing.length) {
        let content;
        try { content = parsePersonalPage(html, reply.url); } catch { return fail('unreadable'); }
        found.push({ url: reply.url, mimeType: 'text/html', bytes: reply.body,
          sha256: createHash('sha256').update(reply.body).digest('hex'), preview: content.text.slice(0,12000) });
      }
      return leaf;
    }
    while (queue.length) {
      // A fresh work item always gets a full single-file allowance. A large file only accounts for its own batch.
      if (work && consumed && (next.length || remaining < KNOWLEDGE_PDF_MAX_BYTES || gets >= 16)) break;
      const item = queue.shift()!;
      if (!work && visited.has(item.url)) continue;
      visited.add(item.url);
      let result;
      try { result = await scan(item); }
      catch (e) {
        if (work && consumed && ['file_too_large','limit','listing_changed'].includes(failure)) break;
        throw e;
      }
      consumed++;
      for (const original of result.found) originals.set(original.url, original);
      if (work) next.push(...result.children);
      else for (const child of result.children) {
        if (visited.has(child.url) || queue.some(item => item.url === child.url)) continue;
        if (visited.size + queue.length >= 32) fail('limit');
        queue.push(child);
      }
      if (!work && originals.size > 16) fail('limit');
    }
    await current();
    return work || originals.size ? accepted() : { status: 'failed', reason: 'unreadable' };
  } catch {
    if (gate && !signal.aborted) {
      try { await current(); return { status: 'needs_user', reason: gate }; } catch { /* Authorization or cancellation wins. */ }
    }
    return { status: 'failed', reason: failure };
  }
}
