import type { ComponentProps, ComponentType } from "react";
import { Switch as PaperSwitch } from "react-native-paper";

const MarkedSwitch = PaperSwitch as ComponentType<ComponentProps<typeof PaperSwitch> & { dataSet?: Record<string, string> }>;
export function Switch(props: ComponentProps<typeof PaperSwitch>) {
  return <MarkedSwitch {...props} dataSet={{ motionSwitch: "true" }} />;
}
