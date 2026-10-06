import { brand } from "../branding";
import { PageFrame } from "../components/PageFrame";
import { FamilyView } from "../components/family/FamilyView";
import { useProduction } from "../production/ProductionProvider";
import { ProductionFamilyOperationNotice, useProductionSettingsDomains } from "../production/SettingsDomains";

export default function FamilyPage() {
  const { actions } = useProduction(), { family } = useProductionSettingsDomains();
  return <PageFrame density="compact" title="家庭協調" description="認清一起照顧的人、各自的角色，讓交接與共享範圍清楚可查。" eyebrow={`${brand.name} · 家庭`}>
    <FamilyView production model={family.model} actions={{ ...family.actions, openProfile: () => actions.open("profile") }}
      onTasks={() => actions.open("tasks")} onContact={() => actions.open("contact")}
      writeNotice={<ProductionFamilyOperationNotice />} previewControls={null} />
  </PageFrame>;
}
