import { createServer } from 'node:http';
import { chmod, lstat, readFile, unlink } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { renderCatalogue } from './source-card-render.mjs';

const socketPath = '/run/source-browser/render.sock';
const maxBody = 6 * 1024 * 1024;
const bounded = (value, max) => Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) <= max;
const cgroup = async name => (await readFile('/sys/fs/cgroup/' + name, 'utf8')).trim();
const proc = await readFile('/proc/self/status', 'utf8');
const [quota, period] = (await cgroup('cpu.max')).split(' ');
if (!process.getuid() || Object.keys(networkInterfaces()).some(name => name !== 'lo') ||
    !/^NoNewPrivs:\s*1$/mu.test(proc) || !/^CapEff:\s*0+$/mu.test(proc) || !/^Seccomp:\s*2$/mu.test(proc) ||
    !bounded(await cgroup('memory.max'), 768 * 1024 * 1024) || !bounded(await cgroup('pids.max'), 192) ||
    !bounded(quota, Number(period))) throw Error('source_browser_isolation_required');

let busy = false;
const server = createServer({ maxHeaderSize: 4096, requestTimeout: 25_000, headersTimeout: 4000 }, async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end(busy ? 'busy' : 'ready'); return;
  }
  if (req.method !== 'POST' || req.url !== '/render' || !bounded(req.headers['content-length'], maxBody)) {
    res.writeHead(400).end(); return;
  }
  if (busy) { res.writeHead(503).end(); return; }
  busy = true;
  const cancel = new AbortController(), timer = setTimeout(() => cancel.abort(), 18_000);
  res.once('close', () => cancel.abort());
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > maxBody) throw Error('limit'); chunks.push(chunk); }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!Array.isArray(input.resources) || input.resources.length > 32 || typeof input.url !== 'string' ||
        !input.resources.some(r => r.url === input.url)) throw Error('invalid');
    const result = await renderCatalogue(input, cancel.signal);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(result));
  } catch { res.writeHead(422).end(); }
  finally { clearTimeout(timer); busy = false; }
});
server.maxConnections = 4;
server.timeout = 23_000;
try {
  if ((await lstat(socketPath)).isSocket()) await unlink(socketPath);
} catch (e) { if (e.code !== 'ENOENT') throw e; }
process.umask(0o077);
server.listen(socketPath, async () => { await chmod(socketPath, 0o600); });
// Allow the current bounded render to finish when Compose replaces this instance.
process.once('SIGTERM', () => server.close());
