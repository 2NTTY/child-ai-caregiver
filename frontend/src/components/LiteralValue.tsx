import { Platform } from "react-native";

// Browser translation must not rewrite identifiers or checksums. The value itself
// stays untouched; native Text keeps its existing selection and wrapping policy.
export function LiteralValue({ value }: { value: string }) {
  return Platform.OS === "web" ? <span translate="no">{value}</span> : value;
}
