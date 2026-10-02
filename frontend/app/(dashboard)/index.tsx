import { HomeDashboard } from "../../src/components/HomeDashboard";
import { usePreview } from "../../src/preview/PreviewContext";

export default function HomePage() {
  const { model, actions, homeIntroductionPending, markHomeIntroductionPresented } = usePreview();
  return <HomeDashboard model={model} actions={actions} introductionPending={homeIntroductionPending}
    onIntroductionPresented={markHomeIntroductionPresented} />;
}
