import assert from 'node:assert/strict';
import { test } from 'node:test';
import dns from 'node:dns/promises';
import https from 'node:https';
import { createServer, request } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { acquireSourceCardBatch } from '../server/source-card-acquire.ts';

test('one catalogue resumes static listings, rendered download controls and attachments across durable batches', {
  skip: process.env.SOURCE_CARD_BROWSER_ACCEPT !== '1', timeout: 150_000,
}, async t => {
  const origin = 'https://catalogue.example.test', dir = '/books';
  const input = { cardId:'synthetic-card', kind:'directory', entryUrl:origin + dir, allowedPath:dir };
  const png = await sharp({create:{ width:2, height:2, channels:3, background:'#774488' }}).png().toBuffer();
  const staticFiles = Array.from({length:37}, (_,i) => dir+'/static-'+i+'.png');
  const pages = Array.from({length:10}, (_,i) => dir+'/page-'+i);
  const buttonFiles = Array.from({length:19}, (_,i) => dir+'/button-'+i+'.png');
  const nestedFiles = pages.map((_,i) => dir+'/nested-'+i+'.png');
  const allFiles = [...staticFiles, ...buttonFiles, ...nestedFiles];
  const big = dir+'/oversize.pdf', dynamic = dir+'/downloads';
  const anchors = urls => urls.map(url => '<a href="'+url+'">'+url.split('/').pop()+'</a>').join(' ');
  const reads = new Map();
  const app = createServer((req,res) => {
    reads.set(req.url, (reads.get(req.url) ?? 0) + 1);
    assert.equal(req.method, 'GET');
    if (allFiles.includes(req.url)) { res.setHeader('content-type','image/png'); return res.end(png); }
    if (req.url === big) { res.writeHead(200,{'content-type':'application/pdf','content-length':33 * 1024 * 1024}); return res.end(); }
    res.setHeader('content-type','text/html; charset=utf-8');
    if (req.url === dir) return res.end('<main>'+anchors([...staticFiles,big,...pages,dynamic])+'</main>');
    if (req.url === dynamic) return res.end('<main>'+[...buttonFiles,big].map((file,i) => {
      const action = i === 0 || file === big ? "fetch('"+file+"')" : "location.href='"+file+"'";
      return '<button onclick="'+action+'">Download '+i+'</button>';
    }).join('')+'</main>');
    const ix = pages.indexOf(req.url);
    if (ix >= 0) return res.end('<main>'+anchors([nestedFiles[ix],dir])+'</main>');
    return res.writeHead(404).end();
  });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => { app.closeAllConnections(); return new Promise(resolve => app.close(resolve)); });
  t.mock.method(dns, 'lookup', async name => { assert.equal(name,new URL(origin).hostname); return [{address:'1.1.1.1',family:4}]; });
  t.mock.method(https,'request',(url,opts,callback) => {
    assert.equal(url.origin,origin);
    return request({ hostname:'127.0.0.1', port:app.address().port, path:url.pathname, method:opts.method,
      headers:opts.headers, signal:opts.signal, agent:false }, callback);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });

  const root = await mkdtemp(join(tmpdir(),'source-card-batch-')), journal = join(root,'batches.jsonl');
  t.after(() => rm(root,{recursive:true,force:true}));
  const check = { revision:4, checkId:'ce7945f5-ac26-435a-afbc-84d39c99e5fa' };
  const expectedHash = createHash('sha256').update(png).digest('hex');
  const access = { authorize:async id => id === input.cardId };
  const key = item => JSON.stringify([item.url,item.offset ?? 0,item.listingHash ?? '']);
  const seed = {url:input.entryUrl};
  // Each acknowledgement and its discoveries are persisted together. Reopen the journal
  // for every claim, so no adapter or in-process queue can carry progress across calls.
  await appendFile(journal, '');
  let batches = 0, largestRecord = 0;
  for (;;) {
    const records = (await readFile(journal,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
    const known = new Set([key(seed)]), pending = [seed], saved = new Map(), issues = [];
    for (const r of records) {
      pending.splice(0,r.consumed);
      for (const child of r.next) if (!known.has(key(child))) { known.add(key(child)); pending.push(child); }
      for (const [url,hash] of r.files) saved.set(url,hash);
      issues.push(...r.issues);
    }
    if (!pending.length) {
      assert.deepEqual([...saved.keys()].sort(),allFiles.map(path=>origin+path).sort());
      assert.ok([...saved.values()].every(hash=>hash === expectedHash));
      assert.deepEqual(issues,[[origin+big,'file_too_large']]);
      break;
    }
    assert.ok(++batches <= 55, 'The frontier must make forward progress');
    const items = pending.slice(0,8);
    const run = () => acquireSourceCardBatch(input, access, AbortSignal.timeout(35000), {...check,items});
    const result = await run();
    let record;
    if (result.status === 'failed' && result.reason === 'file_too_large') {
      assert.equal(items[0].url,origin+big);
      record = {consumed:1,next:[],files:[],issues:[[items[0].url,result.reason]]};
    } else {
      assert.equal(result.status,'ok',result.reason);
      assert.ok(result.consumed >= 1 && result.consumed <= items.length);
      assert.ok(result.next.length <= 32);
      for (const item of result.next) assert.ok(Object.keys(item).every(k=>['url','offset','listingHash'].includes(k)));
      if (batches === 1) {
        const replay = await run();
        assert.deepEqual(replay,result,'An interruption before acknowledgement must replay the same discoveries');
      }
      record = {consumed:result.consumed,next:result.next,files:result.originals.map(o=>[o.url,o.sha256]),issues:[]};
    }
    const serialized = JSON.stringify(record); largestRecord = Math.max(largestRecord,Buffer.byteLength(serialized));
    await appendFile(journal,serialized+'\n');
  }
  assert.equal(reads.get(dir),5, '49 root entries use four windows plus the interrupted first attempt');
  assert.equal(reads.get(dynamic),3, '20 read controls use three bounded browser windows');
  assert.ok(allFiles.every(path => reads.get(path) === (path === buttonFiles[0] ? 2 : 1)));
  // The first rejection returns the preceding successes. The next claim reports the
  // leading oversized item. Discovery through the button only probes its headers.
  assert.equal(reads.get(big),3);
  t.diagnostic(JSON.stringify({batches, originals:allFiles.length, reportedOversize:1, largestRecordBytes:largestRecord}));
});
