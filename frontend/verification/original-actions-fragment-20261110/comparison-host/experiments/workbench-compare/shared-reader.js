/* Actual canonical case transport, instantiated separately in each comparison document.
 * No fallback to any historical transport or native fetch. */
(function () {
  'use strict';
  const CASES = {"ready":{"caseId":"historical-ready-common-v1","sourcePath":"experiments/fixtures/harbour.js","sourceSha256":"a4e0f2d87d4fe9225530c5318faf729dc1bea24b4fa9694c19fa8f1952d5d1dd","extractedPrefixSha256":"aec860e5349072b333b5cf51ef8a337be065442ff6203eb11caca2968ed46944","factorySha256":"c995a50a75351b906cb536dbe1b0c93c04890f6053695c08f2a731c068b646e0","asOf":"2026-10-25T10:00:00.000Z","timeZone":"Asia/Hong_Kong","mode":"ready","seed":"fixed source literals; no random/date-now path in canonical ready factory","sourceTransformation":"One export-name replacement only; first complete IIFE ending before the closed module graph.","caseSha256":"dbb4bbf316d0d6624f929885673d92b5a372a3dc35510aaa71b772ace091687c","routes":["care","tasks","chat","contact","history","more","summary","settings","photos","growth","memory","profile","family","guide","sources","index"]},"signedout":{"sourcePath":"experiments/fixtures/harbour.js","sourceSha256":"a4e0f2d87d4fe9225530c5318faf729dc1bea24b4fa9694c19fa8f1952d5d1dd","extractedPrefixSha256":"aec860e5349072b333b5cf51ef8a337be065442ff6203eb11caca2968ed46944","factorySha256":"c995a50a75351b906cb536dbe1b0c93c04890f6053695c08f2a731c068b646e0","asOf":"2026-10-25T10:00:00.000Z","timeZone":"Asia/Hong_Kong","sourceTransformation":"One export-name replacement only; first complete IIFE ending before the closed module graph.","caseId":"historical-signedout-common-v1","mode":"signedout","seed":"fixed source literals; independent signedout instance per document","routes":["login"],"permittedReads":["GET /api/auth/get-session","GET /api/account"],"policy":"signedout-exact-unauthenticated-reads-v1","caseSha256":"a550da9fabb7a1c3bab65e99ab0b25efd6f9f1fd3f630f3078b33ba571642fb0"}};
  function createSharedReader(origin, caseKey = 'ready') {
    const CASE = Object.hasOwn(CASES, caseKey) ? CASES[caseKey] : null;
    if (!CASE || !['ready', 'signedout'].includes(CASE.mode)) throw new Error('SHARED_CASE_REQUIRED');
    const fixture = window.__HISTORICAL_SHARED_FACTORY__({origin, mode: CASE.mode});
    const kindSet = new Set(['note','feeding','sleep','diaper','temperature','measurement','appointment']);
    const messages = new Set(fixture.ids.messages);
    const fail = (status, code, operation = 'unsupported-read') => new Response(JSON.stringify({error:{code}}), {status, headers:{'content-type':'application/json','x-comparison-operation':operation}});
    async function transport(input, init = {}) {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, origin);
      const method = String(init.method ?? input?.method ?? 'GET').toUpperCase();
      if (url.origin !== origin || !url.pathname.startsWith('/api/')) throw new TypeError('SHARED_CASE_NETWORK_BLOCKED');
      if (CASE.mode === 'signedout') {
        // Authenticate never reaches the historical factory, even with synthetic inputs.
        if (method !== 'GET') return fail(403,'comparison_read_only','blocked-write');
        if (!['/api/auth/get-session','/api/account'].includes(url.pathname)) return fail(url.pathname.startsWith('/api/auth/') ? 403 : 401,'comparison_read_unavailable','blocked-read');
        if (url.search || url.hash || url.username || url.password || init.body != null || input?.body != null) return fail(400,'invalid_input','read');
        return fixture.transport(input, init);
      }
      if (method === 'POST' && url.pathname === '/api/children/' + fixture.ids.childId + '/care/search' && !url.search) {
        let raw = init.body;
        if (raw === undefined && typeof input?.clone === 'function') raw = await input.clone().text();
        if (typeof raw !== 'string' || raw.length > 4096) return fail(400,'invalid_input','read');
        let body; try { body = JSON.parse(raw); } catch { return fail(400,'invalid_input','read'); }
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['query','kind','cursor'].includes(key)) || body.query !== undefined && (typeof body.query !== 'string' || body.query.length > 200) || body.kind !== undefined && !kindSet.has(body.kind) || body.cursor !== undefined && body.cursor !== null) return fail(400,'invalid_input','read');
        return fixture.transport(url.href, {...init, method:'POST', body:raw, headers:init.headers ?? input?.headers, signal:init.signal ?? input?.signal});
      }
      if (method !== 'GET') return fail(403,'comparison_read_only','blocked-write');
      if (['/api/ai/settings','/api/ai/settings/models','/api/web-push','/api/telegram','/api/notification-preferences'].includes(url.pathname)) {
        if (init.body != null || input?.body != null) return fail(400,'invalid_input','read');
        const headers = new Headers(init.headers ?? input?.headers);
        if (headers.has('x-expected-user-id') && headers.get('x-expected-user-id') !== fixture.ids.userId) return fail(409,'session_changed','read');
        if (url.pathname !== '/api/notification-preferences' && !headers.has('x-expected-user-id')) return fail(428,'account_precondition_required','read');
        if (url.pathname === '/api/ai/settings/models') {
          if ([...url.searchParams.keys()].some(key => key !== 'provider') || url.searchParams.getAll('provider').length > 1 || url.searchParams.has('provider') && !['gemini','vertex','openai-compatible'].includes(url.searchParams.get('provider'))) return fail(400,'invalid_input','read');
        } else if (url.search) return fail(400,'invalid_input','read');
      }
      const resource = /^\/api\/children\/([^/]+)\/(messages|photos)(.*)$/.exec(url.pathname);
      if (resource || ['/api/ai/status','/api/ai/usage'].includes(url.pathname)) {
        if (init.body != null || input?.body != null) return fail(400,'invalid_input','read');
        const headers = new Headers(init.headers ?? input?.headers);
        if (headers.has('x-expected-user-id') && headers.get('x-expected-user-id') !== fixture.ids.userId) return fail(409,'session_changed','read');
        const exactQuery = keys => [...url.searchParams.keys()].every(key => keys.includes(key) && url.searchParams.getAll(key).length === 1);
        if (resource) {
          const [, child, kind, rest] = resource;
          if (child !== fixture.ids.childId) return fail(403,'access_denied','read');
          if (kind === 'photos' || rest !== '') {
            if (!headers.has('x-expected-user-id')) return fail(428,'account_precondition_required','read');
          }
          if (kind === 'messages') {
            if (rest === '') {
              if (!exactQuery(['before']) || url.searchParams.has('before') && !messages.has(url.searchParams.get('before'))) return fail(400,'invalid_input','read');
            } else {
              const reply = /^\/([A-Za-z0-9_-]{1,128})\/reply$/.exec(rest);
              if (!reply) return fail(501,'comparison_read_unavailable','read');
              if (url.search) return fail(400,'invalid_input','read');
              if (!messages.has(reply[1])) return fail(404,'not_found','read');
            }
          } else {
            // Canonical ready has no photos and no next cursor. Never invent a
            // populated album or admit upload/extract routes as successful reads.
            if (url.search) return fail(400,'invalid_input','read');
            if (rest !== '') {
              const photo = /^\/([^/]+)(?:\/content)?$/.exec(rest);
              if (!photo) return fail(501,'comparison_read_unavailable','read');
              if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(photo[1])) return fail(400,'invalid_input','read');
            }
          }
        } else if (url.search) return fail(400,'invalid_input','read');
      }
      return fixture.transport(input, init);
    }
    return Object.freeze({caseKey,mode:CASE.mode,caseId:CASE.caseId,caseSha256:CASE.caseSha256,asOf:CASE.asOf,timeZone:CASE.timeZone,ids:fixture.ids,transport,snapshot:CASE.mode === 'ready' ? fixture.snapshot : () => ({session:null,mode:CASE.mode})});
  }
  window.__CREATE_HISTORICAL_SHARED_READER__ = createSharedReader;
})();
