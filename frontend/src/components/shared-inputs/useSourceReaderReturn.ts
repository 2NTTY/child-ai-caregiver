import { useLayoutEffect, useRef, type RefObject } from "react";
import { Platform, type View, type ScrollView, type ScrollViewProps } from "react-native";
import { useNavigationAuthority } from "../../navigation/NavigationAuthority";
import type { SourceReaderPosition } from "../../navigation/source-reader-position";

export function useSourceReaderReturn({ scopeKey, selectedId, listRef, readerRef, scrollRef }: {
  scopeKey: string; selectedId: string | null; listRef: RefObject<View | null>; readerRef: RefObject<View | null>; scrollRef: RefObject<ScrollView | null>;
}) {
  const authority = useNavigationAuthority();
  const rowRefs = useRef(new Map<string, View>()), offset = useRef(0);
  const origin = useRef<{ scope: string; position: SourceReaderPosition } | null>(null);
  const pending = useRef<{ scope: string; position: SourceReaderPosition } | null>(null);
  const previous = useRef<{ scope: string; selectedId: string | null } | null>(null);
  function focus(node: View | null | undefined) {
    if (!node) return false;
    if (Platform.OS === "web") {
      const element = node as unknown as HTMLElement;
      if (!element.isConnected || element.closest('[inert]')) return false;
      element.focus(); return document.activeElement === element;
    }
    node.focus(); return true;
  }
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { scope: scopeKey, selectedId };
    if (before && before.scope !== scopeKey) { origin.current = null; pending.current = null; offset.current = 0; return; }
    if (!before && authority) {
      const retained = authority.sourcePosition.read(authority);
      if (retained) origin.current = { scope: scopeKey, position: retained };
    }
    if (before?.selectedId === selectedId) return;
    if (selectedId) {
      const requested = pending.current;
      const position = requested?.scope === scopeKey && requested.position.originId === selectedId
        ? requested.position : { originId: selectedId, scrollOffset: origin.current?.position.scrollOffset ?? offset.current };
      origin.current = { scope: scopeKey, position }; pending.current = null;
      authority?.sourcePosition.write(authority, position);
      focus(readerRef.current);
    } else if (origin.current?.scope === scopeKey) {
      const position = origin.current.position;
      scrollRef.current?.scrollTo({ y: position.scrollOffset, animated: false });
      if (!focus(rowRefs.current.get(position.originId))) focus(listRef.current);
    }
  }, [scopeKey, selectedId, authority, listRef, readerRef, scrollRef]);
  const onScroll: ScrollViewProps["onScroll"] = event => { offset.current = event.nativeEvent.contentOffset.y; };
  return { onScroll,
    rowRef(id: string, node: View | null) { if (node) rowRefs.current.set(id, node); else rowRefs.current.delete(id); },
    remember(id: string) { pending.current = { scope: scopeKey, position: { originId: id, scrollOffset: offset.current } }; },
  };
}
