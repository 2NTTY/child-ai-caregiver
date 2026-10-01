# 共用 Android 介面

適用 `frontend/` 的手機畫面與平台外殼，基線 Expo 57.0.24／Router 57.0.22／React Native 0.86.3／Paper 5.15.3／safe-area-context 5.7.0，最後核對 2026-09-30。只有需要原生介面時讀本檔；不處理正式 Server 接線、FCM、APK 簽署或實機驗收。

- 共用模型、Paper 控件、表單 schema、theme token 和畫面。Web 的 AppShell／Slot 與原生 NativeAppShell／Tabs 在 dashboard layout 按 Platform 選擇，不复制另一套業務狀態。
- 採用 Expo Router 的 JavaScript Tabs（React Navigation bottom tabs）；圖示沿現有 AppIcon／PaperSvgIcon 的 SVG 映射，非主要頁用 `href: null` 保留路由，由帳戶／更多選單開啟。不能把圖中尚無正式來源的「知識庫」或醫療重點變成假操作。
- Root 使用 SafeAreaProvider；原生外殼透過 useSafeAreaInsets 處理自訂頂欄及抽屜，Tabs 保留自身的底部安全區。不要重複加入底部 inset 或畫假的系統狀態欄。Android 表單沿 window resize，Tabs 使用 tabBarHideOnKeyboard；這些配置仍須實機驗證。
- viewport 只決定組件如何重排；頁內多欄由 onLayout 的內容寬度決定。320 的容器、表單與選单都要檢查，不能只看整頁 scrollWidth 而漏掉被裁切的控件。字體採原生預設可伸縮字體，不為套截圖固定全部尺寸。
- Web 僅在 Platform 為 web 時使用 window／beforeunload；原生不能直接執行 DOM 或瀏覽器 API。返回鍵先關已開抽屜，帳戶和身份變更沿正式控制器清理；不把本地記憶體或 Expo bundle 當已登入／已保存。
- 照片／拍照入口復用 `PhotoFilePicker` 的讀檔、原檔校驗與清理。Web 用明確按下的原生 file input；拍照偏好只在相機用的 input 加 `capture=environment`，另留普通選檔。capture 相容性有限，手機可能提供系統拍照、桌面通常只提供選檔，不能宣稱 Webcam 或實機相機已驗；不在路由載入時自動開相機。原生的 `selectOriginal`／`captureOriginal` 是分開的薄 port，未注入時停用，不能用相簿 adapter 冒充相機。
- Agent 工具列只提供已有流程入口及真實能力說明。語音未接通時顯示未接通並保留文字草稿，不畫假錄音／轉文字；PDF／Word 不由照片 MIME 或分享文字契約推造支援。URI 只帶有限入口 intent，不帶私人問題、原文、檔名或 blob URL。官方參考：[MDN capture](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture)／[Expo ImagePicker](https://docs.expo.dev/versions/latest/sdk/imagepicker/)，2026-10-01 補核；本包未安裝 ImagePicker，官方方案相容性不代表原生 adapter 已實作。
- `expo export --platform android` 只驗 JS／資產 bundle；Android Web 預覽只驗共享畫面。APK 安裝、系統字體／鍵盤／返回鍵／安全區／TalkBack、帳戶和相機／通知權限另列待驗收，不能據 bundle 成功標 P3 已完成。

官方資料已核對：[JavaScript Tabs](https://docs.expo.dev/router/advanced/tabs/)、[Safe Areas](https://docs.expo.dev/develop/user-interface/safe-areas/)。本項目實作檢查及限制見 [HANDOFF](../../../../HANDOFF.md)；實際證據獨立記錄，文件相容不代表真機通過。

## 手機比例與密度

- 先量度目前內容、再改共用 `theme.ts` 的 `mobileLayout`／`mobileType`。主頁按參考圖的區塊次序組裝；不按圖片實體像素縮放整頁，不用 PixelRatio 修正設計尺寸。RN 的數字是邏輯單位；Web 的 CSS px 檢查不能代替 Android dp／sp 實機。
- Android 官方採 8dp 主間距、4dp 細節及至少 48dp 觸控；Apple 至少 44pt。本項目主要手機控制統一至少 48 邏輯單位，SVG 的可見尺寸與可按範圍分開。詳情長、系統字體放大時，容器可增高／重排；不關閉 `allowFontScaling`、不以截斷重要文字或縮小字體避開溢出。
- 沿 Paper 5.15.3 的 MD3 tokens：主標題 titleLarge 22／28、區塊 titleMedium 16／24、密集正文 bodyMedium 14／20，較長正文可用 bodyLarge 16／24，次層 bodySmall／labelMedium 12／16。語義角色決定字級，不把手機全部字體改成同一數值；禁止把約數、待核對及 unknown 移除以縮短畫面。一般 SVG 採 20、導航 22、突出符號 24，入口的實際觸控仍至少 48；不將「24 的圖標」誤當「24 的按鈕」。這些是本工程取用的成熟基線，並非所有手機 App 的唯一標準。
- 共用 SectionHeader 在手機把標題／動作放一列，說明另列；長標題仍可換行。孩子卡片分開年齡摘要與日期基準，顯示模型缺任一項時用完整 ageLabel，不解析已格式化文字。快速記錄按內容實際寬度重排，按鈕不固定文字高度。對話捷徑可以獨立橫向滾動，整頁不能橫向溢出；鍵盤能到達每項，現有草稿不能被捷徑覆蓋。
- 共用外殼／尺寸改動才補四種 Web 寬度與受影響互動。另驗一次放大文字的 Web 重排，標明不等於原生 Dynamic Type／TalkBack；真機和系統行為仍待驗。

本輪官方依據：[Android grids and units](https://developer.android.com/design/ui/mobile/guides/layout-and-content/grids-and-units)、[Android touch targets](https://developer.android.com/guide/topics/ui/accessibility/apps)、[Apple design tips](https://developer.apple.com/design/tips/)、[RN 0.86 sizes](https://reactnative.dev/docs/0.86/height-and-width)、[RN 0.86 text scaling](https://reactnative.dev/docs/0.86/text#allowfontscaling)。研究與項目取捨見 [MOBILE_DESIGN](../../../../MOBILE_DESIGN.md)；已核對文件，實作證據按工作包另列，不換成熟框架或引入第二套手機業務模型。

本輪補核字級／圖標：[Paper 5.15.3 tokens](https://github.com/callstack/react-native-paper/blob/v5.15.3/src/styles/themes/v3/tokens.tsx)、[Material Android typography](https://github.com/material-components/material-components-android/blob/master/docs/theming/Typography.md)、[Lucide sizing](https://lucide.dev/guide/lucide/basics/sizing)。已對照本機相同 Paper 版本的 tokens 原文；不要改 Desktop tokens 來縮小手機。
