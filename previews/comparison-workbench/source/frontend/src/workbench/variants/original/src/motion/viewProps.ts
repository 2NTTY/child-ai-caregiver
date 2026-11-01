import type { ViewProps } from "react-native";

// RN Web supports dataSet, but native ViewProps intentionally omits this web-only prop.
export type MotionViewProps = ViewProps & { dataSet?: Record<string, string | number> };
export function motionData(dataSet: NonNullable<MotionViewProps["dataSet"]>) { return { dataSet }; }
