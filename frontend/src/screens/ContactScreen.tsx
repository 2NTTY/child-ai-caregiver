import { usePathname } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { JournalSection } from "../components/journal/JournalLayout";
import { useProduction } from "../production/ProductionProvider";
import { useProductionContactDomain } from "../production/SettingsDomains";
import { ContactView } from "../components/contact/ContactView";
import { RouteTextLink } from "../components/RouteTextLink";
import { PageFrame } from "../components/PageFrame";

export function ContactScreen() {
  const { model } = useProduction(), contact = useProductionContactDomain();
  const pathname = usePathname(), focused = useIsFocused();
  const child = model.children.find(item => item.id === model.selectedChildId);
  return child ? <ContactView production model={contact.model} actions={contact.actions} active={focused && pathname === "/contact"} /> :
    <PageFrame density="compact" title="聯絡授權"><JournalSection title="先選擇孩子" description="選擇孩子後，可核對本人的接收同意與任務聯絡授權。"><RouteTextLink label="選擇或新增孩子" href="/guide" /></JournalSection></PageFrame>;
}
