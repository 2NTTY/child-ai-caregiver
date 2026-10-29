import { useCallback } from "react";
import type { BottomTabBarButtonProps } from "expo-router/tabs";
import { Pressable, type View } from "react-native";
import { MobileNavSelection } from "./MobileNavSelection";

/** Adapt the router's animated host ref to the concrete native Pressable host. */
export function NativeTabBarButton({ ref, children, ...props }: BottomTabBarButtonProps) {
  const buttonRef = useCallback((node: View | null) => {
    if (typeof ref === "function") return ref(node);
    if (ref) ref.current = node;
  }, [ref]);
  return <Pressable {...props} ref={buttonRef}>
    {props["aria-selected"] ? <MobileNavSelection /> : null}{children}
  </Pressable>;
}
