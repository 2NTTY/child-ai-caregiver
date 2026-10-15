import { readFile } from "node:fs/promises";

interface PromptModule { id: string; path: string; version: string; requires: string[] }
interface PromptRecipe { id: string; additionalModules: string[]; outputModes: string[]; requiredInputs: string[] }
export interface PromptManifest {
  version: string;
  promptBoundary: { begin: string; end: string };
  baseModules: string[];
  domain: { requiredModules: string[] };
  modules: PromptModule[];
  recipes: PromptRecipe[];
  outputModeRequirements: Record<string, string[]>;
}
export type AgentOutputMode = "text" | "tool_cycle" | "structured";
export interface AssembledPrompt { text: string; packVersion: string; recipeId: string; moduleIds: string[]; moduleCharacters: Record<string, number> }

/** Only server-selected recipes and capabilities may reach this assembler. */
export async function assembleAgentPrompt(options: {
  manifest: PromptManifest;
  recipeId: string;
  mode: AgentOutputMode;
  availableInputs: readonly string[];
  additionalModuleIds?: readonly string[];
  readModule: (path: string) => Promise<string>;
}): Promise<AssembledPrompt> {
  const { manifest, recipeId, mode, availableInputs, readModule } = options;
  const invalid = () => new Error("Invalid agent prompt configuration");
  if (!/^\d+\.\d+\.\d+$/u.test(manifest.version)) throw invalid();
  const recipe = manifest.recipes.find(item => item.id === recipeId);
  if (!recipe || !recipe.outputModes.includes(mode)) throw invalid();
  const required = [...recipe.requiredInputs, ...(manifest.outputModeRequirements[mode] ?? [])];
  if (required.some(input => !availableInputs.includes(input))) throw invalid();
  const ids = [...new Set([...manifest.baseModules, ...manifest.domain.requiredModules, ...recipe.additionalModules,
    ...(options.additionalModuleIds ?? [])])];
  const modules = new Map(manifest.modules.map(item => [item.id, item]));
  if (modules.size !== manifest.modules.length || new Set(manifest.recipes.map(item => item.id)).size !== manifest.recipes.length) throw invalid();
  const { begin, end } = manifest.promptBoundary;
  if (!begin || !end || begin === end) throw invalid();
  const parts: string[] = [], moduleCharacters: Record<string, number> = {};
  for (const id of ids) {
    const entry = modules.get(id);
    if (!entry || !/^[a-z0-9-]+(?:\/[a-z0-9-]+)+\.md$/u.test(entry.path)
      || !/^\d+\.\d+\.\d+$/u.test(entry.version) || entry.requires.some(dependency => !ids.includes(dependency))) throw invalid();
    const document = await readModule(entry.path);
    if (!document.includes(`- ID：\`${id}\``) || !document.includes(`- 版本：\`${entry.version}\``)) throw invalid();
    const start = document.indexOf(begin);
    const finish = document.indexOf(end);
    if (start < 0 || finish <= start || document.indexOf(begin, start + begin.length) !== -1
      || document.indexOf(end, finish + end.length) !== -1) throw invalid();
    const body = document.slice(start + begin.length, finish).trim();
    if (!body) throw invalid();
    parts.push(body); moduleCharacters[id] = body.length;
  }
  return { text: parts.join("\n\n"), packVersion: manifest.version, recipeId, moduleIds: ids, moduleCharacters };
}

export async function loadAgentPrompt(recipeId: string, mode: AgentOutputMode, availableInputs: readonly string[],
  additionalModuleIds?: readonly string[]) {
  // This manifest and the module files are shipped with the server, never supplied by a client.
  const manifest = JSON.parse(await readFile(new URL("../prompts/manifest.json", import.meta.url), "utf8")) as PromptManifest;
  return assembleAgentPrompt({ manifest, recipeId, mode, availableInputs, additionalModuleIds,
    readModule: path => readFile(new URL(`../prompts/${path}`, import.meta.url), "utf8") });
}
