import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repo = path.dirname(root);
const bundle = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies');
export const modules = process.env.RUNTIME_NODE_MODULES || path.join(bundle, 'node/node_modules');
export const python = process.env.RUNTIME_PYTHON || path.join(bundle, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3');
process.env.RUNTIME_NODE_MODULES = modules;
const requireFromRuntime = createRequire(path.join(modules, '__presentation__.cjs'));
export const runtimeRequire = (name) => requireFromRuntime(name);
export const runtimeImport = (name) => import(pathToFileURL(requireFromRuntime.resolve(name)).href);

export function skillDirectory() {
  if (process.env.PRESENTATION_SKILL_DIR) return path.resolve(process.env.PRESENTATION_SKILL_DIR);
  const base = path.join(os.homedir(), '.codex/plugins/cache/openai-primary-runtime/presentations');
  const candidates = fs.existsSync(base) ? fs.readdirSync(base).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })) : [];
  for (const version of candidates) {
    const candidate = path.join(base, version, 'skills/presentations');
    if (fs.existsSync(path.join(candidate, 'container_tools/artifact_tool_utils.mjs'))) return candidate;
  }
  throw new Error('Presentation skill not found. Set PRESENTATION_SKILL_DIR to the installed skill directory.');
}

export function runPython(args) {
  const result = spawnSync(python, ['-B', ...args], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  if (result.status !== 0) throw new Error(`Python check failed: ${result.stderr || result.stdout || result.error}`);
  return result.stdout.trim();
}

export function options(argv = process.argv.slice(2)) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || !argv[i + 1]) throw new Error(`Expected --option value: ${argv[i]}`);
    result[argv[i].slice(2)] = argv[i + 1];
  }
  return result;
}

export async function readJson(file) { return JSON.parse(await fs.promises.readFile(file, 'utf8')); }
export function assertWithin(base, file) {
  const relative = path.relative(base, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Output must stay within ${base}`);
}
