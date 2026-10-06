import { HomeDashboard } from "../../src/components/HomeDashboard";
import { useProduction } from "../../src/production/ProductionProvider";

export default function HomePage() {
  const { model, actions, homeIntroductionPending, markHomeIntroductionPresented } = useProduction();
  return <HomeDashboard model={model} actions={actions} introductionPending={homeIntroductionPending}
    onIntroductionPresented={markHomeIntroductionPresented} />;
}
