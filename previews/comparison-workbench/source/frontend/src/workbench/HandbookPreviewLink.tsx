import {useRef,useEffect,type ReactNode} from 'react';
import {Platform} from 'react-native';
import {Link,usePathname,type Href} from 'expo-router';
import {usePreviewNavigation} from '../preview/PreviewNavigationGuard';
import {useCommittedNavigationAuthority as useNavigationAuthority,useCompositionRouter as useRouter} from './TasksComposition.mjs';
const staysInDashboard=(path:string,href:Href)=>path==='/tasks'&&typeof href==='object'&&href.pathname==='/tasks';
export function PreviewLink({ href, children, onAccepted, intent, disabled = false }: { href: Href; children: ReactNode; onAccepted?(): void; intent?: "workspace" | "navigation"; disabled?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const leave = usePreviewNavigation();
  const authority = useNavigationAuthority();
  const current = useRef({ pathname, href, disabled, mounted: true });
  current.current = { pathname, href, disabled, mounted: true };
  useEffect(() => { current.current.mounted = true; return () => { current.current.mounted = false; }; }, []);
  return <Link href={href} asChild onPress={event => {
    if (disabled) { event.preventDefault(); return; }
    if (Platform.OS === "web") {
      // Modified/middle clicks open another browsing context and do not leave this draft.
      type WebClick = { defaultPrevented?: boolean; button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean };
      const click = event as unknown as WebClick & { nativeEvent?: WebClick };
      if ([click, click.nativeEvent].some(value => value && (value.defaultPrevented || value.metaKey || value.ctrlKey || value.shiftKey || value.altKey || value.button !== undefined && value.button !== 0))) return;
    }
    event.preventDefault();
    if (href === pathname) return;
    leave(() => {
      if (!current.current.mounted || current.current.disabled || current.current.pathname !== pathname || current.current.href !== href || authority && !authority.isCurrent()) return;
      onAccepted?.();
      router.push(href);
    }, intent ?? (staysInDashboard(pathname, href) ? "workspace" : "navigation"));
  }}>{children}</Link>;
}
