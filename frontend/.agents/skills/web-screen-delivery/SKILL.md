---
name: web-screen-delivery
description: 在育伴港 frontend/ 隔離 Expo 工程中，依參考圖實作或審核 Web／手機介面、共用 Paper 表單、操作狀態及交接；不適用 Server／Agent 接線或正式 Android 真機驗收。
---

# 育伴港 Web 畫面交付

適用 frontend/ 的 Web 畫面工作包。先依 [前端流程](../../../WORKFLOW.md)核對根目錄功能真況、active worktree、參考圖規則與待接線範圍；本 Skill 不覆蓋根目錄的產品或 API 決策。

1. 先按 [前端流程](../../../WORKFLOW.md) 讀 GitHub master 的 P2 UI 交接，再局部讀當前 API／型別／client 封裝，固定核對 commit；本機副本只作比對。從參考圖提取可重用的顏色、層次、密度、導覽、表單與狀態規則，更新 [設計規則](../../../DESIGN_SYSTEM.md)。不複製圖片中的假功能、假資料或與育伴港 Logo／美術衝突的元素。
2. 沿用現有 Expo Router 結構：app/ 只保留路由與 layout 入口，畫面實作在 src/screens/，共享外殼與 Paper 薄封裝在 src/components/，主題 tokens 在 src/theme.ts，合成 fixture 與前端狀態在 src/preview/。不用為了套新版模板遷移已存在的路由根。組件樣式以 StyleSheet.create 共置，不造單一 HTML／CSS 巨檔。Paper Portal 內若要展示共用狀態，由外殼傳入資料與回調，避免在移動後的子樹重新讀取預覽 context；本版窄屏資訊欄曾因此出錯，須納入開欄檢查。
3. 用 Paper 5.x 控件與現有 AppButton／AppTextField／AppSelect／AppCheckbox／AppDialog／AppMenuList；只封裝品牌及反覆語義。SVG 圖標集中 AppIcon／PaperSvgIcon，改主題或圖標前讀 [品牌主題與 SVG](references/theme-and-svg.md)，補齊 MD3 色彩角色並核對 SDK 相容版本。RN Web 0.21.2 的原生 accessibilityState 不等於 DOM 狀態，選單明確補 aria-expanded、單選／勾選補 aria-checked、分頁補 aria-selected。共用 AppCheckbox 驗 Space，不每頁複製 adapter。AppDialog 沿 Paper 官方 accessible modal 建議，以 RN Modal 承載 Paper Dialog，驗 Tab 焦點限制／Escape／返回焦點。閱讀 [表單與控件](references/forms-controls.md) 才改日期、時間、選單或彈窗；不 fork vendor 或替換整套框架。
4. 畫面由資料模型和操作回調驅動；合成預覽清楚標示不連 Server。待確認、處理中、已保存、失敗、結果未知各自呈現；網絡可用不等於保存。切換孩子時隔離該孩子的資料和草稿；本人渠道則按身份／Server 隔離，切孩子不重綁。渠道畫面先讀 [CHANNELS_HANDOFF](../../../CHANNELS_HANDOFF.md) 的已核對位置，不從截圖或 Platform.OS 推造真瀏覽器能力、投遞或未讀；accepted／回覆／照護完成分開。正式版的權限、收據與原 opId 查核由主聊天接線。
5. 重要表單沿項目已採用 RHF 7.88／Zod 4.5，透過 Controller 接 Paper；錯誤靠近欄位，原文不經 trim／數字轉換覆蓋。view model／回調只屬顯示層，Server 協定仍以根目錄型別為準。沿實際成功回應才標 saved；有收據的 unknown 鎖定並查同一參考，不能用第二次 submit 代替查核。直接秘密設定沒有 opId／收據，不套用業務重試器：清秘密，重讀 metadata／版本後重新確認；本人模型的接口及清理入口見 [MODEL_SETTINGS_HANDOFF](../../../MODEL_SETTINGS_HANDOFF.md)。409 先比較最新內容，再由使用者明確換基準並重新核對。
6. 依變更執行必要 typecheck／build／針對性合成預覽。共用外殼變更才擴至所有靜態路由；不因換工作包例行重跑完整舊測試。至少檢查受影響頁的 1440／1024／390／320 CSS px、鍵盤及適用操作狀態，區分 document overflow 與容器裁切的內容溢出。展示實際截圖，更新前端 STATUS／PLAN／HANDOFF。真服務／正式 E2E 沿主聊天 P2 集中驗收安排。
7. 需要手機軟件介面時讀 [原生介面指引](references/native-ui.md)。手機 Web、Android bundle、Android 實機三份證據不可混用。開包、整合前及交付前同步 GitHub 遠端引用，核對 frontend 重疊；不改其他聊天 checkout 或 root 指導文件。

RHF／Zod 復用結論沿 [項目已有研究](../../../../docs/TECH_REUSE.md) 與 TaskPanel，frontend 依賴固定 RHF 7.88.0／resolvers 5.9.1／Zod 4.5.4。本次補充核對日期為 2026-09-29；原 Web 官方來源仍適用。

技術基線：Expo 57.0.24、Expo Router 57.0.22、React Native Web 0.21.2、React Native Paper 5.15.3；最後核對 2026-09-29。官方文件已核對：[Expo Router 檔案規則](https://docs.expo.dev/router/basics/core-concepts/)、[Expo Router layout](https://docs.expo.dev/router/basics/navigation-layouts/)、[Expo project-structure skill](https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-project-structure/SKILL.md)、[Expo design-system skill](https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-design-system/SKILL.md)、[Paper theming](https://oss.callstack.com/react-native-paper/docs/guides/theming)、[Paper icons](https://oss.callstack.com/react-native-paper/docs/guides/icons)。本項目的實作與驗證證據見 [HANDOFF.md](../../../HANDOFF.md)；官方文件核對不等同正式 API 驗收。
