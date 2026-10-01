# Web 捲動及模糊面板

只有修改 `frontend/` 的共用 ScrollView、覆蓋式捲動或介紹文字底板時讀本檔。基線：Expo 57.0.24、RN Web 0.21.2、React 19.2.3、OverlayScrollbars 2.16.0、expo-blur 57.0.3；最後核對 2026-10-02。版面需求以 [設計規則](../../../../DESIGN_SYSTEM.md) 為準，本檔不管理 Server、認證、APK 或實機驗收。

## 選擇成熟能力

Windows 傳統捲動條即使軌道透明，也可能佔內容寬度；`scrollbar-gutter: stable` 刻意保留空間，不能滿足零佔寬需求。官方文件已核對 [MDN scrollbar-gutter](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/scrollbar-gutter)。

比較 [OverlayScrollbars](https://kingsora.github.io/OverlayScrollbars/) 與 [Radix Scroll Area](https://www.radix-ui.com/primitives/docs/components/scroll-area)：兩者都保留原生捲動並提供覆蓋式滑塊。本工程採 MIT 的 OverlayScrollbars 2.16.0，沒有 npm 執行依賴，可直接指定現有 RN Web viewport；Radix 1.2.18 需要不同的 Root／Viewport 組合及額外元件，未採用／未安裝。不另寫滑塊位置、拖動或鍵盤事件系統。

文字底板用 Expo 原生 BlurView，expo-blur 57.0.3 與 Expo 57.0.24 的 bundledNativeModules 相符，MIT。先核對當前 Expo SDK 所列版本，不按 latest 手動跨 SDK 升級。Web 的 [backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter) 模糊的是後方內容，需要半透明背景；不要對含文字的容器直接套 `filter: blur`。

## 共用 ScrollView adapter

- 沿 [AppScrollView.web](../../../../src/components/AppScrollView.web.tsx)；原生檔直接導出 RN ScrollView。DOM、CSS 與套件初始化只放 `.web`；橫向清單直接用原有 ScrollView，不套垂直滑塊。
- 用 RN Web 公開的 `getScrollableNode()` 指定既有 viewport，外層 host 同時是 target／scrollbar slot。保留 onScroll、contentContainerStyle、keyboardShouldPersistTaps 及原 ScrollView ref；不要另造一個捲動 viewport 或綁第二套 wheel／PageDown。
- 以 `showsVerticalScrollIndicator={false}` 從首幀隱藏會佔寬的原生 Web bar，OverlayScrollbars 的 visibility 依原顯示設定決定；不能透過所有場景一律隱藏可見滑塊來冒充修復。viewport 可鍵盤聚焦。
- 共用 [CSS](../../../../src/components/appScrollView.css) 只使用官方 `--os-*` 變數：透明軌道、既有 theme 的 controlOutline／ink、40 最小滑塊、10 覆蓋區。保留內容內距，按鈕不要位於滑塊下；forced-colors 沿系統 CanvasText，不新增品牌色。
- effect 初始化每個區域，卸載呼叫 destroy；路由更換、主內容／資訊欄及 Dialog 不共享錯誤的 instance。不要全頁掃描 DOM 或在 Server 渲染期間使用 document。CSS 型別用局部 `*.css` declaration，不關閉整個 TypeScript 檢查。
- 無固定高度的 Dialog／選單需要自然高度和適當 maxHeight；Web wrapper 的 minWidth／minHeight 為 0，不將 auto-height 一律變成 flexBasis 0。雙欄轉直排時，原 `flex: 1` 可能壓縮欄高並讓內容溢出重疊；按實際容器改為不縮、自然 basis，不能用遮蔽內容的固定高度補救。

## Expo 模糊底板

沿 [Expo BlurView 官方文件](https://docs.expo.dev/versions/latest/sdk/blur-view/) 的 light tint／intensity 和既有圓角，BlurView 包住介紹文字，背景部分透明，文字保持清晰。不同瀏覽器支援不能從一次 Web 截圖推斷；不支援實際模糊時仍需有可讀 tint。

SDK 57 的 Android 真模糊需要 BlurTargetView／blurTarget；未提供目標時不能聲稱已實現原生模糊。本工程手機登入不渲染故事區，較寬原生畫面目前僅 tint 後備，後續有此需求才由正式 App 接目標並作實機驗收。不為純 Web 改版擴做 native 模糊平台。

## 必要驗證

共用元件變動檢查受影響路由的四種 Web 寬度，以及低高度 Dialog。量度 viewport 的 clientWidth／offsetWidth、軌道透明度、覆蓋定位、自然內容高度及相鄰卡片間距；溢出出現／消失不應移動控制。針對滾輪／鍵盤／拖滑塊、主內容及資訊欄獨立捲動、Escape／焦點還原和卸載清理作局部合成檢查，避免重跑無關業務。

文件核對與實作驗證分開：FE-W24 的 Web export／局部量度、60 個重排及 Android bundle 證據見 [交接](../../../../HANDOFF.md#responsive-scroll)；沒有真 API、其他瀏覽器／輔助技術、APK 或 Android 實機證據。只改圖片漸淡時沿用未受影響的共用捲動證據，不例行再次全跑。

其他官方來源：[RN Web ScrollView](https://necolas.github.io/react-native-web/docs/scroll-view/)、[OverlayScrollbars 原始碼及 MIT 許可](https://github.com/KingSora/OverlayScrollbars)。
