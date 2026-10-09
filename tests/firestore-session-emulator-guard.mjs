import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';

// Synthetic contract probe. Network confinement is retained from the environment gate.
const port = Number(process.argv[2]);
assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
const host = `127.0.0.1:${port}`;
const projectId = 'demo-yuban-session-validation';
function requireEmulatorTarget(candidateHost, candidateProject) {
  if (candidateHost !== host || candidateProject !== projectId || !candidateProject.startsWith('demo-')) {
    throw new Error('Explicit isolated emulator target required');
  }
}
requireEmulatorTarget(process.env.FIRESTORE_EMULATOR_HOST, projectId);
for (const name of ['GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'GOOGLE_API_KEY', 'GEMINI_API_KEY']) {
  assert.equal(process.env[name], undefined, 'No credentials or production project configuration is permitted');
}
assert.throws(() => requireEmulatorTarget(undefined, projectId));
assert.throws(() => requireEmulatorTarget('firestore.googleapis.com:443', projectId));
assert.throws(() => requireEmulatorTarget(host, 'non-demo-project'));

const connections = [];
const blocked = [];
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const values = Array.isArray(args[0]) ? args[0] : args;
  const options = typeof values[0] === 'object' ? values[0] : { port: values[0], host: values[1] };
  if (options?.path || options?.host !== '127.0.0.1' || Number(options?.port) !== port) {
    blocked.push({ kind: 'socket', host: options?.host ?? null, port: options?.port ?? null });
    throw new Error('Non-emulator network connection denied');
  }
  connections.push({ host: options.host, port: Number(options.port) });
  return connect.apply(this, args);
};
tls.connect = () => { blocked.push({ kind: 'tls' }); throw new Error('TLS/cloud connection denied in emulator probe'); };
const lookup = dns.lookup;
dns.lookup = (hostname, ...args) => {
  if (hostname !== '127.0.0.1') {
    blocked.push({ kind: 'dns' });
    throw new Error('External DNS denied in emulator probe');
  }
  return lookup(hostname, ...args);
};
const lookupAsync = dns.promises.lookup;
dns.promises.lookup = async (hostname, ...args) => {
  if (hostname !== '127.0.0.1') {
    blocked.push({ kind: 'dns' });
    throw new Error('External DNS denied in emulator probe');
  }
  return lookupAsync(hostname, ...args);
};


export { port, host, projectId, connections, blocked };
