// Exact Care source rendering; state/actions/recovery remain host-owned.
import type { CareSlotPorts } from './CareSlotPorts';
import { AppButton } from "../components/ui";
import { chineseFont, colors, mobileLayout, readingType, spacing } from "../theme";
export function CareHeaderActions({model,occupied,showPanel,onAgent,rememberList,actions,onHistory}: Pick<CareSlotPorts, 'model'|'occupied'|'showPanel'|'onAgent'|'rememberList'|'actions'|'onHistory'>) {
return <>
    {model.access === "editable" ? <><AppButton label="請助手安排" density="compact" variant="secondary" disabled={occupied} onPress={() => { onAgent(); }} />
      <AppButton label="手動新增" accessibilityLabel="手動新增共享事項" variant={showPanel ? "quiet" : "primary"} density="compact" disabled={occupied} onPress={() => { rememberList(null); actions.startCreate(); }} /></> : null}
    <AppButton label="歷史" accessibilityLabel="事項歷史" variant="quiet" density="compact" disabled={occupied} onPress={() => { onHistory(); }} />
  </>;
}
