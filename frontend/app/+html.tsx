import type { PropsWithChildren } from "react";
import { ScrollViewStyleReset } from "expo-router/html";

// This server-rendered document sets the language before the application hydrates.
export default function RootDocument({ children }: PropsWithChildren) {
  return <html lang="zh-Hant">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <ScrollViewStyleReset />
    </head>
    <body>{children}</body>
  </html>;
}
