import { HomeDashboard } from "../../src/components/HomeDashboard";
import { useProductionHome } from "../../src/production/useProductionHome";

export default function HomePage() {
  const { model, actions, homeIntroductionPending, markHomeIntroductionPresented } = useProductionHome();
  return <HomeDashboard model={model} actions={actions} introductionPending={homeIntroductionPending}
    onIntroductionPresented={markHomeIntroductionPresented} />;
}
