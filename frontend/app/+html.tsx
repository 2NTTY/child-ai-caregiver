import type { PropsWithChildren } from "react";
import { ScrollViewStyleReset } from "expo-router/html";

export default function Root({ children }: PropsWithChildren) {
  return <html lang="zh-HK">
    <head>
      <meta charSet="utf-8" />
      <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <meta name="theme-color" content="#FFFFFF" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      <meta name="apple-mobile-web-app-title" content="育有方" />
      <link rel="manifest" href="/manifest.webmanifest" />
      <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />
      <ScrollViewStyleReset />
    </head>
    <body>{children}</body>
  </html>;
}
