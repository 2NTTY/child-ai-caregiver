// Actual pinned Harbour JSX and local style declarations; no task owner.
import type { HarbourTasksSlotPorts } from "./HarbourTasksSlotPorts";
import { AppButton } from "../components/ui";
import { chineseFont, colors, spacing, mobileLayout, workspaceType, readingType } from "../theme";
export function HarbourCreateAction({model,occupied,setActionMenu,scopeKey,rememberList,actions}: Pick<HarbourTasksSlotPorts, 'model'|'occupied'|'setActionMenu'|'scopeKey'|'rememberList'|'actions'>) {
return model.access === "editable" ? <AppButton label="新增事項" accessibilityLabel="新增共享事項" density="compact" disabled={occupied}
    onPress={() => { setActionMenu({ scope: scopeKey, open: false }); rememberList(null); actions.startCreate(); }} /> : null;
}
export function HarbourHeaderActions({model,occupied,setActionMenu,scopeKey,onAgent,onHistory,compact,createAction}: Pick<HarbourTasksSlotPorts, 'model'|'occupied'|'setActionMenu'|'scopeKey'|'onAgent'|'onHistory'|'compact'|'createAction'>) {
return <>
    {!compact ? createAction : null}
    {model.access === "editable" ? <AppButton label="請助手安排" variant="secondary" density="compact" disabled={occupied} onPress={() => { setActionMenu({ scope: scopeKey, open: false }); onAgent(); }} /> : null}
    <AppButton label="歷史" accessibilityLabel="事項歷史" variant="quiet" density="compact" disabled={occupied} onPress={() => { setActionMenu({ scope: scopeKey, open: false }); onHistory(); }} />
  </>;
}
