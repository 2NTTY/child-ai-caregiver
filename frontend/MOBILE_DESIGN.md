# 手機比例與密度

FE-W10；2026-09-30。依使用者手機參考圖及現有 Paper／Expo 結構改善 `frontend/`，不修改正式 App 或業務契約。色階沿品牌／OKLCH，不在這包改顏色。

後續畫面復用 [web-screen-delivery Skill](.agents/skills/web-screen-delivery/SKILL.md) 的 [原生手機指引](.agents/skills/web-screen-delivery/references/native-ui.md)，不用重新調查或另起組件系統。

## 成熟方案與取捨

採用現有 React Native Paper 5.15.3、Expo Router 57.0.22 及 React Native 0.86.3，沒有新增 UI 框架。官方方案解決可伸縮尺寸、字體層次、觸控及安全區；參考圖決定育伴港的排列與密度。

使用者再提出圖標／組件／文字偏大的疑慮後，對照 [Paper 5.15.3 原始 tokens](https://github.com/callstack/react-native-paper/blob/v5.15.3/src/styles/themes/v3/tokens.tsx) 及 [Material Android 官方字級](https://github.com/material-components/material-components-android/blob/master/docs/theming/Typography.md)，將首輪 24／18／15 收斂為 MD3 的 22／16／14。這是本工程選用的角色，不是聲稱所有手機正文必須 14。[Lucide](https://lucide.dev/guide/lucide/basics/sizing) 的預設為 24；本工程按角色取 20–24，與可按範圍分開。

- Android [grids and units](https://developer.android.com/design/ui/mobile/guides/layout-and-content/grids-and-units) 使用邏輯 dp／sp 及 4／8 間距節奏；[accessibility](https://developer.android.com/guide/topics/ui/accessibility/apps) 建議至少 48dp 觸控。[Apple design tips](https://developer.apple.com/design/tips/) 採至少 44pt、清楚對齊和靠近相關內容的操作。本項目取較大的 48 作主要控制基線。
- [RN 0.86 尺寸](https://reactnative.dev/docs/0.86/height-and-width) 是邏輯單位；[Text](https://reactnative.dev/docs/0.86/text#allowfontscaling) 預設允許系統字體伸縮。保持文字自然換行與容器增高，不將參考圖縮放成固定畫布。
- 沿現有 SafeAreaProvider／Router Tabs。頂部 inset 由 NativeAppShell 管，底部 inset 由 Tabs 管；tab 最小內容高度與底部安全區分開，不重複 padding。

## 共用規則

`src/theme.ts` 集中 `mobileLayout`／`mobileType`／`mobileIcons`；AppButton、SectionCard、SectionHeader、TextLink、ChildPicker、AppCheckbox、PageFrame 及外殼復用它們。以下是項目採用的 MD3 角色及尺寸，不宣稱所有場景只有同一標準。

| 角色 | 手機規則 | 用途 |
|---|---|---|
| 頁面／卡片 | 邊距 16；區塊間距 16；卡片圓角 16 | 維持均勻內容節奏 |
| 問候／頁面主標題 | 22／28 行高 | 沿 MD3 titleLarge |
| 卡片標題 | 16／24 | 沿 MD3 titleMedium，動作靠右 |
| 正文／項目標題 | 14／20；長正文可用 16／24 | bodyMedium／titleSmall／bodyLarge |
| 操作／次層 | 主操作 14／20，次層 12／16 | labelLarge／labelMedium／bodySmall |
| 主要觸控／圖標 | 至少 48；一般 SVG 20、導航 22、突出 24 | 可見圖標不用填滿按鈕 |
| 問題入口／快速記錄 | 最小 56／88 | 依文字內容增高 |

首頁沿參考的問候、孩子、提問、重點、待辦、快速記錄及內容卡排列。孩子的短年齡仍保留「約」，日期基準放完整寬度的次層列；完整原標籤保留於選單，未同時提供短標籤與日期時照樣顯示完整年齡。不要刪去日期、權限或未保存語義來壓縮畫面。

快速記錄依 onLayout 內容寬度採四格或兩格；標題與「查看」在同一列，說明另列。對話手機輸入區保留本地預覽說明，欄位與短操作同列；提問捷徑放獨立可滑動列，已有草稿時仍禁用捷徑。

## 證據與界線

改前基線 `0ff9533`：390 的孩子卡片高 127，320 高 183，快速記錄格均高 114；見 [before-metrics](verification/fe-w10/before-metrics.json)。改後兩尺寸的孩子卡片均高 110、快速格 88，對話輸入區約 164；見 [after-metrics](verification/fe-w10/after-metrics.json)。這是合成資料、預設文字時的量度，不是固定內容高度。

typecheck、Web 23 個路由輸出及 Android Hermes／31 項資產輸出通過；共用外殼與尺寸改動後，10 頁四種寬度共 40 個重排、390／320 的主要控制觸控、完整年齡選單／切孩子、標題動作、提問與原文草稿、快捷記錄表單及 150% Web 文字重排通過；沒有 pageerror、console.error 或 /api/ 請求。見 [checks](verification/fe-w10/checks-layout-mobile-density.json)／[build-checks](verification/fe-w10/build-checks.json)。首次手機流程檢查曾點在 Paper radio 的文字層，被真正單選控制攔截；改為操作 radio 本身後通過，沒有 force click。

實際運行畫面：[390 主頁](verification/fe-w10/home-390.png)、[320 主頁](verification/fe-w10/home-320.png)、[完整排列](verification/fe-w10/home-390-full-layout.png)、[320 對話](verification/fe-w10/chat-320.png)、[150% 文字孩子卡片](verification/fe-w10/child-large-text-320.png)。使用者的視覺確認仍待回饋。

窄 Web 使用同一個手機首頁 React Native 元件，但外殼仍是 Web。Android bundle 只驗打包；原生系統字體、安全區、鍵盤／返回鍵、TalkBack、APK 和真 API 均需主聊天另行驗收，不能從 Web 截圖推斷已通過。

## FE-W11 照片入口接續

手機主頁第二格改成「照片記錄」，符合參考圖的快速記錄排列，仍使用同一個 SVG／88 最小高度／四或兩格規則。照片頁按原圖、人工核對、清單排單欄；短按鈕文字配完整 accessible label，主要控制仍至少 48，正文／次層沿 14／12。原生更多選單及照顧記錄也可到達；原生相簿／相機的 `selectOriginal` adapter 未接，不冒稱選圖權限已驗。

共用密度及照片增加後，44 個重排與 390／320 手機必要互動、快捷入口、150% Web 文字均通過；見 [FE-W11 checks](verification/fe-w11/checks-layout-photos-mobile-density.json)／[metrics](verification/fe-w11/after-metrics.json)／[完整手機首頁](verification/fe-w11/home-390-full-layout.png)。Web 25 路由及 Android Hermes／31 資產 export 通過，原生真機門檻保持待驗。

## FE-W12 問候區品牌插畫

2026-10-01 使用者要求問候區改用桌面主頁的海旁家庭美術。MobileHomeDashboard 直接復用 `harbour-family-hero.png`，文字與圖片排兩欄；圖片框佔可用寬度 34%、最多 120、高 108，靠右顯示照顧者及孩子。文字欄可換行並隨內容增高，沿原有字級；插畫屬裝飾，略過朗讀及鍵盤操作。

沿用成熟 RN Image／現有品牌素材，毋須新組件庫或美術。390／320 手機密度、原年齡基準／孩子切換／草稿／快捷記錄及 150% Web 文字通過；typecheck、Web 25 路由及 Android Hermes 31 資產 export 通過。證據在 [FE-W12 checks](verification/fe-w12/checks-mobile-density.json)／[build-checks](verification/fe-w12/build-checks.json)，實際 [390](verification/fe-w12/home-390.png)／[320](verification/fe-w12/home-320.png)。只驗共用源碼與 Web／bundle，使用者視覺及原生實機仍待驗。
