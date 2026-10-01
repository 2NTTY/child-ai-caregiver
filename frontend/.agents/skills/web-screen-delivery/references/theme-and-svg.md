# 品牌主題與 SVG 圖標

適用 frontend 的 Paper 5.15.3／Expo 57.0.24／Lucide React Native 1.49.0／react-native-svg 15.15.4。最後核對：2026-10-01；只在修改主題、彈窗、選單、圖標或背景漸變時讀。產品／狀態語義沿根契約。

- 配色先讀 frontend/COLOR_STRATEGY.md 的當前使用者選擇，再參照 assets/BRIEF.md 保留 Logo／美術。FE-W20 指定 Happy Hues 14 取代 UI 舊色盤，原值及角色集中 theme.ts；不得再套舊綠色／暖灰。六主色直接採原值，缺少的表面／警告深淺色按種子 h 派生 OKLCH、clamp sRGB 及核對對比，原生輸出 HEX。來源角色、設計映射和狀態語義分開，不逐頁加色。
- 色階與放置分開。只核對 [Happy Hues 14](https://www.happyhues.co/palettes/14) 的逐區指導及實際畫面；沿 COLOR_STRATEGY 的白色內容、青色區域、深色文字／普通提交、黃色 Agent 強調。MD3 primary 保持深色，accent 才是黃底深字，避免黃色文字／checkbox 在白底不可讀；普通卡片不強制深色。額外 error 角色沿既有契約語義。其他成熟來源沿既有研究，不因換包重查或覆蓋使用者選擇。
- 同一常駐導航區的頂部／側欄沿用 sidebar，內容畫布及白色卡片按用途分層。Carbon 的 light layers 可交替，dark layers 才逐層變亮；不為模仿層次而每個區域另造色值。
- 內嵌控制與外層分開：淺青導航內的孩子切換／資料標籤／側欄開關沿白色 controlSurface，頭像底用較深青色，避免融入外層。輸入／次要按鈕沿同一 token，白卡內安靜內容可用 quietSurface。核對真實父／子底色及 on*，不只查 primary。
- 更換底色也須核對 hover／ripple／underlay，不能把實色 sage 或其他容器色當擴散色，否則會蓋掉背景與文字。Paper 5.15.3 Button 自動以 textColor 的 12% alpha 產生 ripple；TouchableRipple MD3 預設用 onSurface 的 12%。AgentEntryButton 透過局部 theme.colors.onSurface=colors.onAccent 復用該預設／原生後備，不覆寫全站或自建動畫。按住及放開須看實際透明層與父層底色：Button Web 的 hover 可在內層，不能將它誤當外層黃底。FE-W20 補修核對本機 Button.tsx／TouchableRipple/utils.ts，實際按下、清理、鍵盤及原草稿證據見 frontend/verification/fe-w20-ripple；Android export 不等於原生按下已驗。
- 明確要求轉移焦點時，不能在關閉 Modal 的同一 frame 搶焦點。RN Web 0.21.2 的 focus trap 會先還原開啟者；沿 `AppDialog.onClosed`（RN Modal.onDismiss）在關閉後轉移。RN 0.86 的 onDismiss 只適用 iOS，Android 分開處理且仍需實機驗；沒有明確轉移要求時保留原焦點還原。FE-W18 已核對本機 0.21.2 原文及 Web 行為；[RN Web Modal](https://necolas.github.io/react-native-web/docs/modal/) 文件目前是 0.21.3，不能當作該版本實測；[RN Modal](https://reactnative.dev/docs/0.86/modal#ondismiss)。
- 全幅品牌背景沿 RN Image 配現有 SVG LinearGradient：Defs 內以 useId 產生唯一 id，Rect 透過 fill URL 引用；Stop 使用既有 canvas token 及 stopOpacity，橫向漸淡保護文字，必要時加底部漸淡接回畫布。Image 明確設 100% 寬高／cover；RN Web 0.21.2 實測只設 absoluteFill 仍保留靜態素材 1672×941 原尺寸，須檢查實際人物構圖而不只看無溢出。背景 pointerEvents=none、略過朗讀及焦點；文字可換行、容器以 minHeight 隨大字體增高。官方 API 已核對：[SVG LinearGradient](https://github.com/software-mansion/react-native-svg/blob/main/USAGE.md#lineargradient)，執行證據見 frontend/verification/fe-w12；Web 截圖不當作原生實機通過。
- MD3 的 primary 不會自動更新其餘 surface／elevation／on*／backdrop／disabled 色。完整覆蓋品牌角色，不能遺留預設紫色。Paper 5.15.3 的 Dialog 使用 7 × roundness；roundness 保持倍率基數 4，AppDialog 用共用卡片 radius.large，不能將 16 px 卡片圓角直接當倍率。
- 背景換圖沿 APPEARANCE_HANDOFF 的顯示層 port，不挪用照片／通知偏好契約。Web 只接受可解碼的本地 jpg/png/webp；取消／錯誤保留原圖，替換／恢復／退出釋放 blob，晚回傳不跨範圍。Stack 可保留舊頁，路由區 blur 與 unmount 均須清理。SSR 不讀本地圖片；正式身份／保存及原生 adapter 待主聊天。寬桌面原圖右半區明確設 left=50%，不能以 left=undefined 清除 absoluteFill，RNW 0.21.2 曾因此將插畫藏在左側不透明漸層下。檢查實際構圖與資源生命週期，不能以 build／無溢出代替。
- 反覆導航選單沿 AppMenuList；左圖标、文字、右箭嘴及觸控高度一致。彈窗標題、白底、圓角及 Actions 集中 AppDialog，沿原 RN Modal 焦點／Escape，不以逐頁 CSS 修補 Paper internals。
- 圖標沿 AppIcon 的 Lucide 公開單圖標入口 `lucide-react-native/icons/<canonical-name>` 和統一 stroke／尺寸 token；PaperProvider 的 settings.icon 同樣指向 PaperSvgIcon。新增名稱補同一映射，不載入全量索引。1.49.0 的 CircleHelp／History／Trash2 是別名，實際入口是 circle-question-mark／rotate-ccw-clock／trash；按已安裝套件 exports 及 esm 入口核對，不能由 TypeScript 別名猜路徑。Lucide 採 ISC，部分 Feather 來源採 MIT；react-native-svg 採 MIT。
- 品牌文案沿 src/branding.ts，Logo 沿共用 BrandLogo，保留原 SVG 圖形／比例／美術顏色，不逐頁重造含字 PNG。裝飾 Logo 的可存取名稱留在外層真正連結，獨立 Logo 提供 image 名稱；Web 標題用 Router Head，app.json 的靜態顯示 name 同步，技術 slug／package 不隨文案自動遷移。SVG 文字須按實際字體／尺寸核對字框，不能由舊基線猜新字樣的範圍；FE-W21 四尺寸已驗，Android 字體仍待實機。細節及證據沿 HANDOFF 的品牌更名段落。
- 介面 SVG 屬裝飾，隱藏於輔助技術，名稱及 checked／expanded／selected 留在真正控制項上。AppIcon 外層 RN View 管 accessible／importantForAccessibility；SVG 用 aria-hidden／focusable，不把 accessible=false 直接傳入本版 SVG Web DOM，否則出現非布林屬性錯誤。顏色型別沿 RN ColorValue，Paper icon color 可缺省。孩子／帳戶頭像保持正方尺寸及不縮扁，切換觸控至少 44。
- 缺少 SVG renderer 才增加依賴；沿 Expo 已安裝 SDK 的 bundledNativeModules.json 核對 react-native-svg 版本，不能以最新 npm 版本代替 SDK 相容性。本包採 15.15.4，Lucide peers 已核對 React 19／SVG 15；文件相容與 Android 實機分開。
- 改主題／全站圖標後才跑受影響的靜態路由重排與共用控件。npm run verify:colors 查已列明的實際 token 對比；合成 design 檢查白底／合理圓角、SVG、選單、切換比例。Web／Android export 各自查 build，不把 Web PNG 當原生畫面。
- 以 `expo serve` 檢查 export，不能只憑 Metro 開發預覽判斷靜態輸出。SSR 與第一個 client render 必須一致；本隔離預覽的 root 先渲染固定品牌啟動畫面，effect 後才掛載依 viewport 重排的路由。原生路由不延遲，Web 私人預覽需 JavaScript 才有內容；不要將此做法宣稱完整內容 SSR／SEO 或盲目推到公開內容頁。收集 pageerror 及 console.error；React 418 須修復不一致，不能忽略或 suppress。favicon 沿 app.json 指向 frontend 內原有品牌副本。
- 導航控件沿 Expo Router 的 Link asChild 包住 Pressable／TouchableRipple，保留真 href 及框架導航；不能只設 accessibilityRole=link 再手寫 router.push。RN Web 0.21.2 會把 role=link 當原生互動，沒有 href 的 div 不會因 Enter 自動 click。Router 57.0.22 的 Slot／Radix 會合併直接子元件的 style；先用 StyleSheet.flatten 轉成物件，不能直接傳 array 或 style function，否則生產輸出可能出現 CSS indexed property 錯誤或遺失樣式。互動樣式以元件 state 控制或留在內層元件。必須驗鍵盤、目前頁面及保留草稿，不能只驗滑鼠；參考 [Expo 導航](https://docs.expo.dev/router/basics/navigation/)，FE-W08 記錄實際證據。一般表單操作沿 AppButton。

官方來源：[Paper 主題](https://oss.callstack.com/react-native-paper/docs/guides/theming)、[Paper icon 設定](https://oss.callstack.com/react-native-paper/docs/guides/icons)、[Lucide React Native](https://lucide.dev/guide/react-native)、[Lucide 許可](https://lucide.dev/license)、[Expo SVG](https://docs.expo.dev/versions/latest/sdk/svg/)、[Culori API](https://culorijs.org/api/)、[CSS Color 4](https://www.w3.org/TR/css-color-4/#ok-lab)、[WCAG 文字](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)／[控制項對比](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)。

角色及輸出核對來源：[Material 3 主題](https://developer.android.com/codelabs/m3-design-theming?hl=en)、[Carbon 色彩](https://carbondesignsystem.com/elements/color/overview/)、[Atlassian 色彩](https://atlassian.design/foundations/color)／[層次](https://atlassian.design/foundations/elevation)、[React SSR 首次渲染](https://react.dev/reference/react/useEffect#displaying-different-content-on-the-server-and-the-client)、[Expo Web export 預覽](https://docs.expo.dev/guides/publishing-websites/)。

已核對套件源碼及版本；FE-W06 核對 16 個 token 對比，FE-W07 補查狀態容器後共 18 組。執行畫面／建置證據見 frontend/verification/fe-w06-design、fe-w07 及 HANDOFF。真 API、完整可存取驗收和 Android 實機未因本研究通過。

FE-W18 增補 controlSurface 兩組，共 20 組通過；父／子表面、輸入入口、Web 焦點及六寬度共用 Dialog／選單證據見 frontend/verification/fe-w18。沒有實機相機／咪高峰或正式服務驗收。

FE-W20：Happy Hues 14 官方頁面的角色及實際畫面已核對；新色盤 22 組對比、四尺寸重排／背景及共用輸出證據見 frontend/verification/fe-w20。主題實測與原生選圖／背景保存／完整無障礙驗收分開。
