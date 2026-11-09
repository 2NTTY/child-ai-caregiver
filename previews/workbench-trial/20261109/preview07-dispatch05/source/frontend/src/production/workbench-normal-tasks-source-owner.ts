import { observeNormalSourceBinding, registerNormalSourceOwner } from "../preview/workbench-normal-source-control.mjs";
/** DERIVED synthetic source-view seam. Native provider effects own session startup. */
import { ProductionOwner } from "./ProductionOwner";
import { createRecordsApi } from "../../../src/client/records-api.ts";
import { createAccountApi } from "../../../src/client/account-api.ts";
import { createAccountAuthApi } from "../../../src/client/account-auth-api.ts";
import type { ChildSelection, ChildSelectionPreferences } from "../../../src/client/child-selection.ts";
import { createNormalTasksReadBootstrap } from "../preview/workbench-normal-read/src/normal-read-bootstrap.mjs";
import registry from "../preview/workbench-normal-read/sources/registry.json" with { type: "json" };

export function createNormalTasksSourceOwner(online: boolean): ProductionOwner {
  const variant = "harbour" as const;
  const origin = "https://normal-bootstrap.invalid";
  const userId = "preview-owner";
  const selection: ChildSelection = { childId: "c0b00000-0000-4000-8000-000000000001", workspaceId: "c0b00000-0000-4000-8000-000000000012" };
  const binding = createNormalTasksReadBootstrap({ registry, variant, scenario: "normal", origin,
    fixtureSha256: "d108aca1f8248e76e28ce4ab5c3497005cff5f1e6f15f2d23081b8d32bd2d5e4",
    extensionSha256: "2e9175cd7b4f4556742cf785799255872155433e37c47f90c784280549105dee" });
  const fetcher = observeNormalSourceBinding(binding);
  const records = createRecordsApi(origin, fetcher);
  const account = createAccountApi(origin, fetcher);
  const auth = createAccountAuthApi(origin, fetcher);
  const selections = new Map<string, ChildSelection>([[userId, structuredClone(selection)]]);
  const selectionPreferences: ChildSelectionPreferences = {
    read(id) { return structuredClone(selections.get(id) ?? null); },
    write(id, value) {
      if (id !== userId || value.childId !== selection.childId || value.workspaceId !== selection.workspaceId) throw new Error("NORMAL_SOURCE_SELECTION_NOT_BOUND");
      selections.set(id, structuredClone(selection));
    },
    clear(id) { selections.delete(id); },
  };
  const owner = new ProductionOwner(origin, online, records, undefined, selectionPreferences,
    { api: account, authApi: auth, legacyTrial: false },
    { platform: "web", publicOrigin: origin, fetcher });
  return registerNormalSourceOwner(owner, binding);
}
