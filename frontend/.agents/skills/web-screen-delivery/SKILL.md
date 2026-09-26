---
name: web-screen-delivery
description: 在育伴港 frontend/ 獨立 Expo Web 預覽中，依 UI 參考圖實作或審核可操作畫面、共用組件、狀態與交接；不適用 Server／Agent 接線或 Android 驗收。
---

# 育伴港 Web 畫面交付

適用 frontend/ 的 Web 畫面工作包。先依 [前端流程](../../../WORKFLOW.md)核對根目錄功能真況、active worktree、參考圖規則與待接線範圍；本 Skill 不覆蓋根目錄的產品或 API 決策。

1. 從參考圖提取可重用的顏色、層次、密度、導覽、表單與狀態規則，更新 [設計規則](../../../DESIGN_SYSTEM.md)。不複製圖片中的假功能、假資料或與育伴港 Logo／美術衝突的元素。
2. 沿用現有 Expo Router 結構：app/ 只保留路由與 layout 入口，畫面實作在 src/screens/，共享外殼與 Paper 薄封裝在 src/components/，主題 tokens 在 src/theme.ts，合成 fixture 與前端狀態在 src/preview/。不用為了套新版模板遷移已存在的路由根。組件樣式以 StyleSheet.create 共置，不造單一 HTML／CSS 巨檔。Paper Portal 內若要展示共用狀態，由外殼傳入資料與回調，避免在移動後的子樹重新讀取預覽 context；本版窄屏資訊欄曾因此出錯，須納入開欄檢查。
3. React Native Paper 5.x 提供 Button、TextInput、Dialog、Checkbox、Switch 等成熟控制項；只封裝品牌及反覆出現的語義。新增 icon 時先用 expo install 選 SDK 相容版。本版 Web 實測中，裸 Checkbox／Checkbox.Item 未提供清單所需的 Space 操作與 aria-checked；需要逐項驗鍵盤和讀屏狀態，必要時以可聚焦的 Pressable 包裝 Paper 視覺控制項，並在 Web 明確補狀態。若官方文件與本版 Web 實測衝突，以可重現的 build／瀏覽器結果修正局部做法，記在交接文件。
4. 畫面由資料模型和操作回調驅動；合成預覽清楚標示不連 Server。待確認、處理中、已保存、失敗、結果未知各自呈現；網絡可用不等於保存。切換孩子時隔離可見資料和草稿；正式版的權限、收據與原 opId 查核由主聊天接線。
5. 完成後跑 npm run typecheck、npm run build:web 及 npm run verify:web；至少核對 1440／1024／390／320 CSS px、鍵盤、關閉／重開側欄、空／載入／離線與適用操作狀態。展示實際截圖，更新前端 STATUS／PLAN／HANDOFF，逐項標明「前端已完成／只屬合成預覽／待接線」。

技術基線：Expo 57.0.24、Expo Router 57.0.22、React Native Web 0.21.2、React Native Paper 5.15.3；最後核對 2026-09-26。官方文件已核對：[Expo Router 檔案規則](https://docs.expo.dev/router/basics/core-concepts/)、[Expo Router layout](https://docs.expo.dev/router/basics/navigation-layouts/)、[Expo project-structure skill](https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-project-structure/SKILL.md)、[Expo design-system skill](https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-design-system/SKILL.md)、[Paper theming](https://oss.callstack.com/react-native-paper/docs/guides/theming)、[Paper icons](https://oss.callstack.com/react-native-paper/docs/guides/icons)。本項目的實作與驗證證據見 [HANDOFF.md](../../../HANDOFF.md)；官方文件核對不等同正式 API 驗收。
