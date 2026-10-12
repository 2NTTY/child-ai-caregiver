import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const revision = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(revision ?? '')) throw new Error('A full reviewed Git revision is required');
execFileSync('git', ['cat-file', '-e', revision + '^{commit}'], { cwd: root, stdio: 'pipe' });
const base = resolve(root, 'tmp', 'firebase-function-' + revision.slice(0, 12));
if (!base.startsWith(resolve(root, 'tmp') + sep) || existsSync(base)) throw new Error('Staging directory must be new and inside workspace tmp');
const source = join(base, 'source'); mkdirSync(source, { recursive: true });
const files = ['package.json', 'package-lock.json', 'frontend/package.json', 'server', 'src/shared', 'licenses', 'THIRD_PARTY_NOTICES.md'];
const archive = join(base, 'source.tar');
execFileSync('git', ['archive', '--format=tar', '--output=' + archive, revision, '--', ...files], { cwd: root, stdio: 'pipe' });
execFileSync('tar', ['-xf', archive, '-C', source], { cwd: root, stdio: 'pipe' });
const packageFile = join(source, 'package.json');
const pkg = JSON.parse(readFileSync(packageFile, 'utf8'));
pkg.main = 'firebase-function.mjs';
pkg.scripts = { 'gcp-build': '' };
writeFileSync(packageFile, JSON.stringify(pkg, null, 2) + '\n');
writeFileSync(join(source, 'firebase-function.mjs'), "export { beforeYubanUserCreated } from './server/firebase-blocking.ts';\n");
const output = join(base, 'source.zip');
// Select ZIP explicitly; archive filename inference can emit TAR on Windows.
execFileSync('tar', ['-cf', output, '--format=zip', '-C', source, ...files, 'firebase-function.mjs'], { cwd: root, stdio: 'pipe' });
const sha256 = createHash('sha256').update(readFileSync(output)).digest('hex');
const manifest = { sourceRevision: revision, archiveFormat: 'zip', archiveSha256: sha256, archiveBytes: readFileSync(output).length,
  entryPoint: 'beforeYubanUserCreated', packageOverride: { main: pkg.main, scripts: pkg.scripts }, includes: files };
writeFileSync(join(base, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.info(JSON.stringify({ archive: output, source, ...manifest }));
