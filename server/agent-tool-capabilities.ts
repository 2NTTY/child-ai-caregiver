import { BaseToolset } from "@google/adk";
import type { BaseTool } from "@google/adk";
import { z } from "zod";
import { AgentStopped } from "./agent-budget.ts";
import type { AgentTool } from "./agent-runtime.ts";

export interface AgentToolCatalog {
  readonly coreToolNames: readonly string[];
  readonly loader: { readonly name: string; readonly description: string; readonly parameterDescription: string };
  readonly groups: readonly {
    readonly id: string;
    readonly description: string;
    readonly toolNames: readonly string[];
    readonly promptModuleIds: readonly string[];
  }[];
}

/** One run's trusted capability inventory; exposure never grants execution rights. */
export class AgentCapabilitySelection {
  private readonly catalog: AgentToolCatalog;
  private readonly core: Set<string>;
  private readonly groups: AgentToolCatalog["groups"];
  private readonly loaded = new Set<string>();
  private loading: Promise<void> = Promise.resolve();

  constructor(configuredTools: readonly AgentTool[], catalog: AgentToolCatalog) {
    this.catalog = catalog;
    const invalid = () => new AgentStopped("invalid_tool");
    const names = new Set(configuredTools.map(tool => tool.name));
    const terminal = new Set(configuredTools.filter(tool => tool.terminal).map(tool => tool.name));
    if (!/^[a-z][a-z0-9_]{0,63}$/u.test(catalog.loader.name) || names.has(catalog.loader.name)
      || new Set(catalog.coreToolNames).size !== catalog.coreToolNames.length
      || new Set(catalog.groups.map(group => group.id)).size !== catalog.groups.length) throw invalid();
    this.core = new Set([...catalog.coreToolNames.filter(name => names.has(name)), ...terminal]);
    const assigned = new Set(this.core);
    this.groups = catalog.groups.flatMap(group => {
      if (!/^[a-z][a-z0-9_]{0,63}$/u.test(group.id)
        || new Set(group.toolNames).size !== group.toolNames.length) throw invalid();
      const toolNames = group.toolNames.filter(name => names.has(name) && !terminal.has(name));
      for (const name of toolNames) {
        if (assigned.has(name)) throw invalid();
        assigned.add(name);
      }
      return toolNames.length ? [{ ...group, toolNames, promptModuleIds: [...group.promptModuleIds] }] : [];
    });
    if ([...names].some(name => !assigned.has(name))) throw invalid();
  }

  loadedIds() { return this.groups.filter(group => this.loaded.has(group.id)).map(group => group.id); }

  /** Pure projection of a validated loader batch; no capability is activated here. */
  projectedIds(requested: readonly string[]) {
    return this.groups.filter(group => this.loaded.has(group.id) || requested.includes(group.id)).map(group => group.id);
  }

  moduleIds(ids: readonly string[] = this.loadedIds()) {
    return [...new Set(this.groups.filter(group => ids.includes(group.id)).flatMap(group => group.promptModuleIds))];
  }

  visibleToolNames(ids: readonly string[] = this.loadedIds()) {
    return new Set([...this.core, ...(this.groups.length ? [this.catalog.loader.name] : []),
      ...this.groups.filter(group => ids.includes(group.id)).flatMap(group => group.toolNames)]);
  }

  metadata(ids: readonly string[] = this.loadedIds()) {
    return { ...(this.groups.length ? { loader: this.catalog.loader.name } : {}), loaded: [...ids],
      groups: this.groups.map(({ id, description, toolNames }) => ({ id, description, toolNames })) };
  }

  loader(preparePrompt: (ids: readonly string[]) => Promise<void>): AgentTool | undefined {
    if (!this.groups.length) return undefined;
    return { name: this.catalog.loader.name, description: this.catalog.loader.description,
      parameters: z.object({ capabilities: z.array(z.enum(this.groups.map(group => group.id)))
        .min(1).max(this.groups.length).describe(this.catalog.loader.parameterDescription) }).strict(),
      authorize: async () => true,
      execute: async args => {
        const requested = args.capabilities as string[];
        // Native function batches may contain several loaders; serialize their monotonic union.
        const pending = this.loading.then(async () => {
          const next = this.projectedIds(requested);
          await preparePrompt(next);
          for (const id of requested) this.loaded.add(id);
        });
        this.loading = pending.catch(() => {});
        await pending;
        return { status: "succeeded", data: { loaded: this.loadedIds(), capabilities: [...this.visibleToolNames()] } };
      },
    };
  }
}

/** ADK resolves the current wrapped tools anew for every model step. */
export class AgentCapabilityToolset extends BaseToolset {
  private readonly wrappedTools: readonly BaseTool[];
  private readonly visible: () => ReadonlySet<string>;
  constructor(wrappedTools: readonly BaseTool[], visible: () => ReadonlySet<string>) {
    super([]);
    this.wrappedTools = wrappedTools;
    this.visible = visible;
  }
  override async getTools(): Promise<BaseTool[]> {
    const names = this.visible();
    return this.wrappedTools.filter(tool => names.has(tool.name));
  }
  override async close(): Promise<void> {}
}
