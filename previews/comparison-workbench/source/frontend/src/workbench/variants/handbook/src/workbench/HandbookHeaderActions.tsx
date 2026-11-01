// Exact Handbook JSX/styles; state, authority, refs and recovery remain in the host.
import type { HandbookTasksSlotPorts } from './HandbookTasksSlotPorts';
import { AppButton, AppSelect, AppSelectionTrigger, AppTextField, SectionCard, UnderlineTabs, AppTabPanel } from "../components/ui";
import { RouteTextLink } from "../components/RouteTextLink";
export function HandbookHeaderActions({model,occupied,onAgent,rememberList,actions}: Pick<HandbookTasksSlotPorts, 'model'|'occupied'|'onAgent'|'rememberList'|'actions'>) {
return <>
    {model.access === "editable" ? <><AppButton label="新增事項" accessibilityLabel="手動新增共享事項" disabled={occupied} onPress={() => { rememberList(null); actions.startCreate(); }} />
      <AppButton label="請助手安排" variant="secondary" disabled={occupied} onPress={onAgent} /></> : null}
    <RouteTextLink href="/history?category=tasks" intent="workspace" label="事項歷史" disabled={occupied} />
  </>;
}
