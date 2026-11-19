import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, createHash } from 'node:crypto';
import http, { createServer, request } from 'node:http';
import { once } from 'node:events';
import https from 'node:https';
import dns from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';
import JSZip from 'jszip';
import sharp from 'sharp';
import { inspectSourcePage, sourceCardScope } from '../server/source-card-page.ts';

const origin = 'https://catalogue.example.test';
const input = { cardId: 'synthetic-card', entryUrl: origin + '/books/index', kind: 'directory', allowedPath: '/books',
  login: { url: origin + '/signin', submitUrl: origin + '/signin/verify' } };

test('source card enforces registered path boundaries and classifies manual gates', () => {
  const validate = sourceCardScope(input);
  const entryUrl = origin + '/landing?id=1';
  const document = sourceCardScope({ ...input, kind: 'document', entryUrl });
  assert.equal(document(entryUrl).href, entryUrl);
  assert.throws(() => document(origin + '/landing?id=2'));
  assert.throws(() => document(origin + '/books/original.pdf'));
  const bulletin = sourceCardScope({ ...input, kind:'bulletin', entryUrl });
  assert.equal(bulletin(entryUrl).href, entryUrl);
  assert.throws(() => bulletin(origin + '/landing?id=2'));
  assert.equal(bulletin(origin + '/books/page2').pathname, '/books/page2');
  assert.equal(validate(origin + '/books?page=2').pathname, '/books');
  for (const path of ['/bookshelf/1', '/account', '/books/logout', '/books/a?token=private'])
    assert.throws(() => validate(origin + path));
  for (const [html, gate] of [
    ['<input type=password>', 'login'], ['<input autocomplete=one-time-code>', 'mfa'],
    ['<div data-sitekey="sample"></div>', 'captcha'], ['<h1>Purchase required</h1>', 'purchase'],
  ]) assert.equal(inspectSourcePage(html, input.entryUrl).gate, gate);
});

// Use the real fetcher, cookie jar, form submission, Unix socket, headless browser and file readers.
// Substitute only DNS and the final TLS connection with an in-process synthetic HTTP site.
test('one bound site signs in once, paginates and downloads exact Word and image originals', {
  skip: process.env.SOURCE_CARD_BROWSER_ACCEPT !== '1', timeout: 60_000,
}, async t => {
  const password = randomBytes(18).toString('hex'), ticket = randomBytes(18).toString('hex');
  const csrf = randomBytes(18).toString('hex'), username = 'fixture-reader';
  const word = new JSZip();
  word.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  word.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  word.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Fixture handbook</w:t></w:r></w:p></w:body></w:document>');
  const doc = await word.generateAsync({ type:'nodebuffer' });
  const png = await sharp({ create:{ width:2, height:2, channels:3, background:'#007799' } }).png().toBuffer();
  let posts = 0, renders = 0, allBound = true, allReads = true;
  const paths = [];
  const app = createServer(async (req,res) => {
    paths.push(req.url);
    // Avoid including any credential value in test diagnostics.
    allBound &&= !req.headers.authorization && !req.url.includes(password) && !req.url.includes(ticket);
    const html = value => { res.setHeader('content-type','text/html'); res.end(value); };
    switch (req.url) {
      case '/signin':
        res.setHeader('set-cookie','before=preflight-value; Path=/signin; Secure; HttpOnly');
        return html('<form method="post" action="/signin/verify"><input name="who" type="email"><input name="pass" type="password"><input type="hidden" name="csrf" value="'+csrf+'"></form>');
      case '/signin/verify': {
        ++posts;
        const parts = []; for await (const part of req) parts.push(part);
        const data = new URLSearchParams(Buffer.concat(parts).toString());
        if (req.method !== 'POST' || req.headers.cookie !== 'before=preflight-value' || req.headers.origin !== origin ||
            data.get('csrf') !== csrf || data.get('who') !== username || data.get('pass') !== password) return res.writeHead(403).end();
        res.setHeader('set-cookie','auth='+ticket+'; Path=/books; Secure; HttpOnly');
        return res.writeHead(303,{ location:'/books/index' }).end();
      }
      default:
        if (req.method !== 'GET') allReads = false;
        if (req.headers.cookie !== 'auth='+ticket) return res.writeHead(401).end();
    }
    if (req.url === '/books/index') return html('<main><a rel="next" href="/books/page2">Next</a><a href="/outside/doc.pdf">PDF</a></main>');
    if (req.url === '/books/page2') return html('<main><button id="download">Download Word</button><a href="/books/photo.png">Photo</a></main><script src="/books/ui.js"></script>');
    if (req.url === '/books/ui.js') {
      res.setHeader('content-type','application/javascript');
      return res.end("document.querySelector('#download').onclick=()=>{const a=document.createElement('a');a.href='/books/handbook.docx';a.download='handbook.docx';a.click()}");
    }
    if (req.url === '/books/handbook.docx') {
      res.setHeader('content-type','application/vnd.openxmlformats-officedocument.wordprocessingml.document'); return res.end(doc);
    }
    if (req.url === '/books/photo.png') { res.setHeader('content-type','image/png'); return res.end(png); }
    return res.writeHead(404).end();
  });
  app.listen(0,'127.0.0.1'); await once(app,'listening');
  t.after(() => { app.closeAllConnections(); return new Promise(resolve => app.close(resolve)); });
  const port = app.address().port;
  const httpRequest = http.request;
  t.mock.method(http, 'request', (...args) => {
    const outbound = httpRequest(...args);
    if (args[0]?.socketPath) {
      renders++;
      const end = outbound.end.bind(outbound);
      outbound.end = (bytes, ...rest) => {
        allBound &&= [password, ticket, csrf, username].every(secret => !bytes.includes(secret));
        return end(bytes, ...rest);
      };
    }
    return outbound;
  });
  t.mock.method(dns, 'lookup', async host => {
    assert.equal(host, new URL(origin).hostname); return [{ address:'1.1.1.1', family:4 }];
  });
  t.mock.method(https, 'request', (url, opts, cb) => {
    if (url.origin !== origin) throw Error('Unexpected fixture origin');
    return request({ hostname:'127.0.0.1', port, path:url.pathname + url.search, method:opts.method,
      headers:opts.headers, signal:opts.signal, agent:false }, cb);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const { acquireSourceCard } = await import('../server/source-card-acquire.ts');
  const access = { authorize: async id => id === input.cardId, credentialFor: async () => ({origin, username, password}) };
  const result = await acquireSourceCard(input, access, AbortSignal.timeout(50_000));
  assert.equal(result.status, 'ok', result.reason);
  assert.equal(posts,1); assert.ok(renders >= 2); assert.ok(allBound && allReads);
  assert.deepEqual(paths, ['/signin','/signin/verify','/books/index','/books/page2','/books/ui.js','/books/photo.png','/books/handbook.docx']);
  const actual = new Map(result.originals.map(o => [new URL(o.url).pathname, o]));
  assert.equal(actual.size,2);
  for (const [path, expected] of [['/books/handbook.docx',doc],['/books/photo.png',png]]) {
    const original = actual.get(path); assert.ok(original);
    assert.equal(original.sha256,createHash('sha256').update(expected).digest('hex'));
    assert.ok(original.bytes.equals(expected));
  }
  assert.match(actual.get('/books/handbook.docx').preview,/Fixture handbook/u);
});
