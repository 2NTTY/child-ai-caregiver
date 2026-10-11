import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const revision = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(revision ?? '')) throw new Error('A full reviewed Git revision is required');
execFileSync('git', ['cat-file', '-e', revision + '^{commit}'], { cwd: root, stdio: 'pipe' });
const base = resolve(root, 'tmp', 'firebase-run-' + revision.slice(0, 12));
if (!base.startsWith(resolve(root, 'tmp') + sep) || existsSync(base)) throw new Error('Staging directory must be new and inside workspace tmp');
mkdirSync(base, { recursive: true });
const files = ['package.json', 'package-lock.json', 'frontend/package.json', '.dockerignore', 'deploy/firebase/Dockerfile',
  'server', 'src/shared', 'licenses', 'THIRD_PARTY_NOTICES.md', 'scripts/firebase-control.mjs', 'scripts/firebase-recovery.mjs'];
const output = join(base, 'source.tar.gz');
execFileSync('git', ['archive', '--format=tar.gz', '--output=' + output, revision, '--', ...files], { cwd: root, stdio: 'pipe' });
const entries = execFileSync('tar', ['-tzf', output], { cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }).trim().split(/\r?\n/u);
if (!entries.includes('deploy/firebase/Dockerfile') || !entries.includes('server/firebase-main.ts') || !entries.includes('server/firebase-worker-main.ts')
  || entries.some(name => name.startsWith('/') || name.split('/').includes('..') || /(^|\/)(?:\.env[^/]*|node_modules|TEAM_CONTRIBUTIONS\.md)(?:\/|$)/iu.test(name)))
  throw new Error('Invalid Firebase source archive');
const bytes = readFileSync(output);
const manifest = { sourceRevision: revision, archiveFormat: 'tar.gz', archiveSha256: createHash('sha256').update(bytes).digest('hex'),
  archiveBytes: bytes.length, entries: entries.length, dockerfile: 'deploy/firebase/Dockerfile', includes: files };
writeFileSync(join(base, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.info(JSON.stringify({ archive: output, ...manifest }));
