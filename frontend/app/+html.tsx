import type { PropsWithChildren } from "react";
import { ScrollViewStyleReset } from "expo-router/html";

// The web document is Traditional Chinese; native routes and data owners are unchanged.
export default function Root({ children }: PropsWithChildren) {
  return <html lang="zh-Hant">
    <head>
      <meta charSet="utf-8" />
      <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <ScrollViewStyleReset />
    </head>
    <body>{children}</body>
  </html>;
}
