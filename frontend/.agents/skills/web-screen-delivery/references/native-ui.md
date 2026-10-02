# 共用 Android 介面

適用 `frontend/` 的手機畫面與平台外殼，基線 Expo 57.0.24／Router 57.0.22／React Native 0.86.3／Paper 5.15.3／safe-area-context 5.7.0，最後核對 2026-09-29。只有需要原生介面時讀本檔；不處理正式 Server 接線、FCM、APK 簽署或實機驗收。

- 共用模型、Paper 控件、表單 schema、theme token 和畫面。Web 的 AppShell／Slot 與原生 NativeAppShell／Tabs 在 dashboard layout 按 Platform 選擇，不复制另一套業務狀態。
- 採用 Expo Router 的 JavaScript Tabs（React Navigation bottom tabs）；圖示用已有 Expo icons，非主要頁用 `href: null` 保留路由，由帳戶／更多選單開啟。不能把圖中尚無正式來源的「知識庫」或醫療重點變成假操作。
- Root 使用 SafeAreaProvider；原生外殼透過 useSafeAreaInsets 處理自訂頂欄及抽屜，Tabs 保留自身的底部安全區。不要重複加入底部 inset 或畫假的系統狀態欄。Android 表單沿 window resize，Tabs 使用 tabBarHideOnKeyboard；這些配置仍須實機驗證。
- viewport 只決定組件如何重排；頁內多欄由 onLayout 的內容寬度決定。320 的容器、表單與選单都要檢查，不能只看整頁 scrollWidth 而漏掉被裁切的控件。字體採原生預設可伸縮字體，不為套截圖固定全部尺寸。
- Web 僅在 Platform 為 web 時使用 window／beforeunload；原生不能直接執行 DOM 或瀏覽器 API。返回鍵先關已開抽屜，帳戶和身份變更沿正式控制器清理；不把本地記憶體或 Expo bundle 當已登入／已保存。
- `expo export --platform android` 只驗 JS／資產 bundle；Android Web 預覽只驗共享畫面。APK 安裝、系統字體／鍵盤／返回鍵／安全區／TalkBack、帳戶和相機／通知權限另列待驗收，不能據 bundle 成功標 P3 已完成。

官方資料已核對：[JavaScript Tabs](https://docs.expo.dev/router/advanced/tabs/)、[Safe Areas](https://docs.expo.dev/develop/user-interface/safe-areas/)。本項目實作檢查及限制見 [HANDOFF](../../../../HANDOFF.md)；實際證據獨立記錄，文件相容不代表真機通過。
