// Extracted from Fourth 76493c5e; presentation only, supplied single-owner ports.
import type { TasksSlotPorts } from '../TasksSlotPorts';
import { AppButton } from "../../components/ui";
export function FourthHeaderActions({model,occupied,setActionMenu,scopeKey,onAgent,rememberList,actions,onHistory}: Pick<TasksSlotPorts, 'model'|'occupied'|'setActionMenu'|'scopeKey'|'onAgent'|'rememberList'|'actions'|'onHistory'>) {
return <>
    {model.access === "editable" ? <><AppButton label="請助手安排" density="compact" disabled={occupied} onPress={() => { setActionMenu({ scope: scopeKey, open: false }); onAgent(); }} />
      <AppButton label="手動新增" accessibilityLabel="手動新增共享事項" density="compact" variant="secondary" disabled={occupied} onPress={() => { setActionMenu({ scope: scopeKey, open: false }); rememberList(null); actions.startCreate(); }} /></> : null}
    <AppButton label="歷史" accessibilityLabel="事項歷史" variant="quiet" density="compact" disabled={occupied} onPress={() => { setActionMenu({ scope: scopeKey, open: false }); onHistory(); }} />
  </>;
}
