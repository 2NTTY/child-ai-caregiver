import { readFileSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
const frontend = new URL('frontend/src/', root);

// Run the real frontend source in Node tests without changing Metro's imports.
// No platform adapters or application exports are mocked by this loader.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(frontend.href) && specifier.startsWith('.') && !extname(specifier)) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (candidate.href.startsWith(root.href) && statSync(candidate, { throwIfNoEntry: false })?.isFile()) {
        return nextResolve(candidate.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.startsWith(frontend.href) || !url.endsWith('.ts')) return nextLoad(url, context);
    const source = ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
      fileName: fileURLToPath(url),
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
    }).outputText;
    return { format: 'module', shortCircuit: true, source };
  },
});
