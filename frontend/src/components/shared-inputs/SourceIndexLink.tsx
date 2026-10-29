import type { ReactNode } from "react";
import type { View } from "react-native";
import { ReadTargetLink } from "../ReadTargetLink";
import { sourceStyles as s } from "./source-styles";

export function SourceIndexLink({ id, label, disabled, onOpen, rowRef, children }: {
  id: string; label: string; disabled: boolean; onOpen(): void; rowRef(node: View | null): void; children: ReactNode;
}) {
  return <ReadTargetLink href={{ pathname: "/sources", params: { sourceId: id } }} label={label} availability={disabled ? "unavailable" : "ready"} onOpen={onOpen} ref={rowRef} style={s.item}>{children}</ReadTargetLink>;
}
