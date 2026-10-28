import appConfig from '../app.json';

/** Rewrite only the installed native sharing callback, preserving other deep links. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const url = new URL(path);
    const configured = appConfig.expo.scheme;
    const schemes = [appConfig.expo.android.package, ...(Array.isArray(configured) ? configured : [configured])];
    if (schemes.includes(url.protocol.slice(0, -1)) && url.hostname === 'expo-sharing'
      && !url.username && !url.password && !url.port && (!url.pathname || url.pathname === '/') && !url.search && !url.hash) return '/share';
  } catch { /* Relative or unrelated native paths keep their existing Router handling. */ }
  return path;
}
