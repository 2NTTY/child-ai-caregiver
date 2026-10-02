# 品牌主題與 SVG 圖標

適用 frontend 的 Paper 5.15.3／Expo 57.0.24／Lucide React Native 1.49.0／react-native-svg 15.15.4。最後核對：2026-09-30；只在修改主題、彈窗、選單或圖標時讀。產品／狀態語義沿根契約。

- 配色先讀 assets/BRIEF.md 及 frontend/COLOR_STRATEGY.md。執行色值集中 theme.ts；保持品牌來源及語義角色，不逐頁加 HEX 或因參考圖而另造品牌色。OKLCH 用於有用途的候選色及明暗色階，色相旋轉不保證語義、色域或對比。原生輸出用已核對的 sRGB HEX。
- 色階與放置分開判斷。沿 Material／Carbon／Atlassian 的用途分工：畫布及常駐側欄用中性色，內容卡片／彈窗用白色，次要操作及普通 SVG 保持中性；品牌色集中於主要操作和選中，琥珀／珊瑚只作相應狀態。用留白、字級、邊界和少量表面層次建立主次，不能將每個標題／圖標／卡片都染成主色。成熟方案提供角色原則，不覆蓋育伴港品牌色或產品語義。
- MD3 的 primary 不會自動更新其餘 surface／elevation／on*／backdrop／disabled 色。完整覆蓋品牌角色，不能遺留預設紫色。Paper 5.15.3 的 Dialog 使用 7 × roundness；roundness 保持倍率基數 4，AppDialog 用共用卡片 radius.large，不能將 16 px 卡片圓角直接當倍率。
- 反覆導航選單沿 AppMenuList；左圖标、文字、右箭嘴及觸控高度一致。彈窗標題、白底、圓角及 Actions 集中 AppDialog，沿原 RN Modal 焦點／Escape，不以逐頁 CSS 修補 Paper internals。
- 圖標沿 AppIcon 的 Lucide 公開單圖標入口 `lucide-react-native/icons/<canonical-name>` 和統一 stroke／尺寸 token；PaperProvider 的 settings.icon 同樣指向 PaperSvgIcon。新增名稱補同一映射，不載入全量索引。1.49.0 的 CircleHelp／History／Trash2 是別名，實際入口是 circle-question-mark／rotate-ccw-clock／trash；按已安裝套件 exports 及 esm 入口核對，不能由 TypeScript 別名猜路徑。Lucide 採 ISC，部分 Feather 來源採 MIT；react-native-svg 採 MIT。
- 介面 SVG 屬裝飾，隱藏於輔助技術，名稱及 checked／expanded／selected 留在真正控制項上。AppIcon 外層 RN View 管 accessible／importantForAccessibility；SVG 用 aria-hidden／focusable，不把 accessible=false 直接傳入本版 SVG Web DOM，否則出現非布林屬性錯誤。顏色型別沿 RN ColorValue，Paper icon color 可缺省。孩子／帳戶頭像保持正方尺寸及不縮扁，切換觸控至少 44。
- 缺少 SVG renderer 才增加依賴；沿 Expo 已安裝 SDK 的 bundledNativeModules.json 核對 react-native-svg 版本，不能以最新 npm 版本代替 SDK 相容性。本包採 15.15.4，Lucide peers 已核對 React 19／SVG 15；文件相容與 Android 實機分開。
- 改主題／全站圖標後才跑受影響的靜態路由重排與共用控件。npm run verify:colors 查已列明的實際 token 對比；合成 design 檢查白底／合理圓角、SVG、選單、切換比例。Web／Android export 各自查 build，不把 Web PNG 當原生畫面。
- 以 `expo serve` 檢查 export，不能只憑 Metro 開發預覽判斷靜態輸出。SSR 與第一個 client render 必須一致；本隔離預覽的 root 先渲染固定品牌啟動畫面，effect 後才掛載依 viewport 重排的路由。原生路由不延遲，Web 私人預覽需 JavaScript 才有內容；不要將此做法宣稱完整內容 SSR／SEO 或盲目推到公開內容頁。收集 pageerror 及 console.error；React 418 須修復不一致，不能忽略或 suppress。favicon 沿 app.json 指向 frontend 內原有品牌副本。

官方來源：[Paper 主題](https://oss.callstack.com/react-native-paper/docs/guides/theming)、[Paper icon 設定](https://oss.callstack.com/react-native-paper/docs/guides/icons)、[Lucide React Native](https://lucide.dev/guide/react-native)、[Lucide 許可](https://lucide.dev/license)、[Expo SVG](https://docs.expo.dev/versions/latest/sdk/svg/)、[Culori API](https://culorijs.org/api/)、[CSS Color 4](https://www.w3.org/TR/css-color-4/#ok-lab)、[WCAG 文字](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)／[控制項對比](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)。

角色及輸出核對來源：[Material 3 主題](https://developer.android.com/codelabs/m3-design-theming?hl=en)、[Carbon 色彩](https://carbondesignsystem.com/elements/color/overview/)、[Atlassian 色彩](https://atlassian.design/foundations/color)／[層次](https://atlassian.design/foundations/elevation)、[React SSR 首次渲染](https://react.dev/reference/react/useEffect#displaying-different-content-on-the-server-and-the-client)、[Expo Web export 預覽](https://docs.expo.dev/guides/publishing-websites/)。

已核對套件源碼及版本；FE-W06 核對 16 個 token 對比，FE-W07 補查狀態容器後共 18 組。執行畫面／建置證據見 frontend/verification/fe-w06-design、fe-w07 及 HANDOFF。真 API、完整可存取驗收和 Android 實機未因本研究通過。
