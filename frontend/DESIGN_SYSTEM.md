# 育伴港 Web 設計規則

本版綜合主頁、Agent 對話、設定及登入參考圖；圖片只決定視覺與組件細節，產品語義仍以根目錄 [SPEC](../SPEC.md) 和 [P2 UI 清單](../docs/P2_UI_HANDOFF.md) 為準。畫面沿用項目 Logo、香港海旁美術及香港繁體中文，不照搬參考圖的嫩芽標誌、人物或虛構數據。

## 共通設計語言

- 暖白、淡綠作大面積背景；深綠文字；青綠只標示主要操作。琥珀代表待確認／結果未知，珊瑚代表明確失敗；顏色必配文字，不以顏色單獨傳達狀態。
- 一個頁面只有清楚的主標題，下面用短說明交代資料範圍；卡片標題、內容、來源／時間次序固定。對話有訊息氣泡、來源區和底部輸入；設定有分頁、資料列及明確未保存提示；登入以品牌故事與表單分區。
- 寬桌面用左導覽、主內容、常駐右資訊欄。設定與用戶固定在左下；右欄可關閉及重開。中寬或窄視窗的右欄改為可開啟面板，手機瀏覽器用底部導覽與「更多」入口，不遺失家庭／記憶／設定路由。
- 右資訊欄先顯示目前孩子與待辦摘要，再顯示已確認記錄及原操作狀態。待辦示例的勾選只在本地預覽有效；頂部鈴鐺的角標只代表需留意的原操作狀態，不代表通知已送達或未讀。窄視窗保留鈴鐺及資訊面板入口，帳戶入口放在底部「更多」。
- 頂部孩子選擇以清楚的雙層字級及柔和邊框呈現；旁邊只顯示所選孩子獲授權且已讀到的檔案摘要，未知資料直接寫「未提供」，切換孩子或載入時不沿用上一位孩子的提示。連線標籤置中並用「已連接」；合成預覽的連線狀態仍須另行標示未接駁 Server。
- 側欄由鈴鐺旁的單一面板圖示開關，不再在資訊欄另放關閉鈕。左上 Logo 置中且可回主頁；左下用深綠「與 Agent 對話」主操作取代裝飾圖。首次登入或配置未完成時，底部導覽才顯示引導入口；設定頁永遠提供重看入口。
- 以 [theme.ts](src/theme.ts) 為唯一色彩、間距、字級和 Paper 主題來源。現行間距為 4／8／12／16／24／32／40 px，圓角 10／16／22 px 及膠囊形，字級 12／14／16／20／28／34 px。Web 使用系統繁體中文字體堆疊，不從外站載入字體。

## 共用組件與規則

| 層 | 共用入口 | 修改一處會影響甚麼 |
|---|---|---|
| 色彩、字體與尺寸 | [theme.ts](src/theme.ts) | 所有使用 token 的畫面、Paper 按鈕／表單／Dialog；新增狀態色先加語義 token，不逐頁寫色碼 |
| 基本控制項 | [ui.tsx](src/components/ui.tsx) 的 AppButton、AppTextField、SectionCard、SectionHeader、TextLink、UnderlineTabs、OperationPill、ConnectionPill | 按鈕高度／字重、輸入框、卡片、設定／記憶分頁與狀態標籤；只封裝品牌及重複語義 |
| 共同外殼 | [AppShell.tsx](src/components/AppShell.tsx)、[ChildKeyFacts.tsx](src/components/ChildKeyFacts.tsx)、[PageFrame.tsx](src/components/PageFrame.tsx) | 左導覽、孩子切換及其授權摘要、資訊欄、預覽情境、內頁標題與內容間距 |
| 待辦與提示 | [PreviewTodoCard.tsx](src/components/PreviewTodoCard.tsx)、[NotificationBell.tsx](src/components/NotificationBell.tsx) | 跨頁一致的右欄待辦示例及頂部原操作提示；兩者只處理展示與本地交互，不擔當正式任務／通知協議 |
| 畫面與路由 | [screens](src/screens)、[app](app) | 每頁只組合現有元件；app 內只保留路由與 layout 入口 |
| 合成狀態 | [view-model.ts](src/view-model.ts)、[preview](src/preview) | 孩子、記錄、連線及原操作展示；不是 Server 契約或正式資料源 |

基礎控制項採 React Native Paper 5.x，圖示依 Expo SDK 相容的 @expo/vector-icons；路由採 Expo Router，樣式用 React Native StyleSheet.create 與組件共置。這是 React Native Web 的成熟做法，毋須把 CSS 集中在一個 HTML 檔。結構參考 [Expo Router 官方規則](https://docs.expo.dev/router/basics/core-concepts/)、[Expo 設計系統 Skill](https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-design-system/SKILL.md) 和 [Paper 主題](https://oss.callstack.com/react-native-paper/docs/guides/theming)。

## 狀態與圖片差異

待確認是候選、處理中是原操作等結果、已保存須有可信收據、失敗須確知未成功、結果未知須以原 opId 查核，網絡可用不代表保存。合成預覽可切換版式，但不能冒稱收到真收據。現有待辦勾選及鈴鐺角標均明示合成來源；沒有完整接線的 Agent 百分比、正式背景任務／通知、附件／咪高峰、疫苗數字、儲存用量和第三方登入不做成假操作；由 [HANDOFF](HANDOFF.md) 列明後續責任。

三款候選動態及實際比較頁見 [MOTION_OPTIONS](MOTION_OPTIONS.md)。目前只是預覽，不把任何一款寫成全站設計規則；選定後才將時長與觸發位置收斂為共用 token／元件行為。
