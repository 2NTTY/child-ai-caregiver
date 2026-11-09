import { createContext, memo, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import type { HomeChild } from "../view-model";
import { GrowthWorkspaceProvider as InjectGrowthWorkspace, type GrowthWorkspaceValue } from "../workspaces/GrowthWorkspace";
import { useGrowthPreview } from "./useGrowthPreview";
import { usePreview } from "./PreviewContext";
import { ownerBoundCallbacks, useOwnerProjection } from "./useOwnerProjection";

type GrowthPreviewTools = Pick<ReturnType<typeof useGrowthPreview>, "condition" | "outcome" | "readScenario" | "changeCondition" | "setOutcome" | "setReadScenario"> & {
  identity: string; server: string; concernLabel?: string;
  changeIdentity(): void; changeServer(): void;
};
const ToolsContext = createContext<GrowthPreviewTools | null>(null);
type GrowthOwnerInput = { child: HomeChild; online: boolean; ownerIdentity: string; server: string };
type GrowthProjection = {
  workspace: GrowthWorkspaceValue;
  tools: Pick<GrowthPreviewTools, "condition" | "outcome" | "readScenario" | "changeCondition" | "setOutcome" | "setReadScenario" | "concernLabel">;
};

// Memo prevents publishing a projection from causing an owner/publisher render loop.
const GrowthOwner = memo(function GrowthOwner({ input, publish, isCurrent }: {
  input: GrowthOwnerInput; publish(value: GrowthProjection): void; isCurrent(): boolean;
}) {
  const { child, online, ownerIdentity, server } = input;
  const preview = useGrowthPreview(child, online, ownerIdentity, server);
  const { condition, outcome, readScenario, changeCondition, setOutcome, setReadScenario } = preview;
  useLayoutEffect(() => publish({
    workspace: { scopeKey: preview.model.scopeKey, model: preview.model, actions: ownerBoundCallbacks(preview.actions, isCurrent) },
    tools: { condition, outcome, readScenario, concernLabel: preview.model.page?.concerns?.label,
      ...ownerBoundCallbacks({ changeCondition, setOutcome, setReadScenario }, isCurrent) },
  }), [preview, publish, isCurrent]);
  return null;
});

// One synthetic owner lives above Growth and History. Only an authority/scope change remounts it.
// It is session-local preview state, not persistence or a replacement GrowthApi.
export function GrowthWorkspaceProvider({ children }: { children: ReactNode }) {
  const { model } = usePreview();
  const child = model.children.find(item => item.id === model.selectedChildId);
  const [identity, setIdentity] = useState("合成媽媽"), [server, setServer] = useState("合成 A");
  const ownerIdentity = JSON.stringify([model.caregiverName, identity]);
  const scopeKey = JSON.stringify([server, ownerIdentity, child?.id ?? null, child?.accessRole ?? "viewer"]);
  const input = useMemo(() => child ? { child, online: model.connection === "online", ownerIdentity, server } : null,
    [child, model.connection, ownerIdentity, server]);
  const projection = useOwnerProjection<GrowthProjection>(scopeKey, input ?? absentInput);
  const changeIdentity = () => { if (projection.isCurrent()) setIdentity(value => value === "合成媽媽" ? "合成爸爸" : "合成媽媽"); };
  const changeServer = () => { if (projection.isCurrent()) setServer(value => value === "合成 A" ? "合成 B" : "合成 A"); };
  const value = input ? projection.value : null;
  return <ToolsContext.Provider value={value ? { ...value.tools, identity, server, changeIdentity, changeServer } : null}>
    <InjectGrowthWorkspace scopeKey={scopeKey} value={value?.workspace ?? null}>
      {input ? <GrowthOwner key={projection.generation} input={input} publish={projection.publish} isCurrent={projection.isCurrent} /> : null}
      {children}
    </InjectGrowthWorkspace>
  </ToolsContext.Provider>;
}
const absentInput = {};
export function useGrowthPreviewTools() { return useContext(ToolsContext); }
