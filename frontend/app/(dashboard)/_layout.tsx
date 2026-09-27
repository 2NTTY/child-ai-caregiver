import { Slot } from "expo-router";
import { AppShell } from "../../src/components/AppShell";
import { PreviewProvider } from "../../src/preview/PreviewContext";

export default function DashboardLayout() {
  return <PreviewProvider><AppShell><Slot /></AppShell></PreviewProvider>;
}
