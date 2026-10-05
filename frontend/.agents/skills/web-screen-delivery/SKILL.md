---
name: web-screen-delivery
description: 在育有方 frontend/ 隔離 Expo 工程中，依參考圖實作或審核 Web／手機介面、共用 Paper 表單、語意動效、操作狀態及交接；不適用 Server／Agent 接線或正式 Android 真機驗收。
---

# 育有方 Web 畫面交付

保存本域可復用的實作與检查方法。工作次序／版本核對用 [WORKFLOW](../../../WORKFLOW.md)，當前包／授權／未驗用 [PLAN](../../../PLAN.md#active)，呈現取捨用 [DESIGN_SYSTEM](../../../DESIGN_SYSTEM.md)。業務契約及特定接線差異只沿 [HANDOFF 索引](../../../HANDOFF.md#p2-coverage) 讀本次功能，不在 Skill 維護第二份。

## 元件及狀態方法

- 沿用 Expo Router：app/ 只作路由／layout，src/screens/ 放畫面，src/components/ 放共用呈現，src/theme.ts 放 tokens，src/preview/ 放合成資料及控制器。樣式用共置 StyleSheet；不要因新版模板搬路由根。Portal 內需用的 scope 資料／回調由擁有者傳入，避免越出 provider 後再讀 context。
- 復用 Paper 5.x 及現有 App* 薄封裝。RN Web 0.21.2 的 accessibilityState 不等於 DOM 狀態；選單／勾選／Tabs 明確核對 aria-expanded／checked／selected 及鍵盤操作。AppDialog 以 RN Modal 承載 Paper Dialog，保留焦點限制、Escape 及返回焦點；細節按下表讀。
- 重要表單沿已採用 RHF／Zod，以 Controller 接 Paper，原文不經 trim／數字轉換覆蓋。動態列用 stable id 保留草稿／基準。pointerdown 的 blur 驗證若令按鈕位移，須驗完整 pointer 提交，不能只用程式 click 或焦點斷言；沿既有 onSubmit／onChange 重驗方法，勿加無依據 timeout。
- view model／回調只呈現合法狀態，不決定授權或重試。網絡可用不是已保存；unknown 必須按該功能的正式契約處理，有收據與無收據的直接操作不可共用假重試器。身份／孩子／Server 變更清理邊界依專項交接，不從畫面或文字猜業務。
- 共用聊天維持 message id、最終快照、每訊息來源／展開狀態及本人跟隨意圖；不把合成 timer 當真 stream、不把已載入視窗當完整歷史。只呈現公開活動，不能顯示內部思維鏈。
- 同類呈現已重用時才抽小型共用元件，資料／回調和內容組裝分開；不把 fixture／控制器搬進通用顯示層。多實例 state／key 要按本人／孩子正確隔離。來源底線、捲動條、固定 composer 等相鄰元素須量度相對位置，不只檢查整頁寬度。

## 多入口與快捷輸入的復用方法

- 功能不同可採不同整頁配方，共用 tokens／控制項及同一資料 owner；新入口只接既有 callback／投影。移動 controller 到共同祖先時，分清需保留的集合、離頁要丟棄的 transient 草稿及 pending／unknown 鎖定，不能僅用重新 mount 全站清資料。
- 跨入口同源須列明唯一掛載點、consumers 與 scope。scope mismatch 先不暴露舊資料，遲到回呼以 generation／scope 比對拒絕；欄位名稱相近不等於同一業務來源，不能將 MemoryTopic 改名當 Growth concern。
- 手勢只選擇輸入方式，不自動送出。按下後曾超過拖曳閾值，即使拖回起點也須抑制後續 click；抑制旗標須跨 scope／路由 effect 重建保留，消耗一次後清除，新實際 pointerdown 或鍵盤啟用才能恢復正常點按；pointercancel、失焦、隱藏、離頁及換 scope 清理。保留直接按鈕與鍵盤等效操作，安全區與底欄預留空間按實際畫面驗證。
- 本地 media adapter 的權限請求只由明確動作啟動；取消後遲到串流也須 stop tracks。錄音停止要等 final dataavailable，記錄真正 MIME，object URL 所有權只能轉移一次，所有結束路徑都釋放。能力、限制及正式接線看 [助手交接](../../../AGENT_HANDOFF.md#mobile-quick-input-design)，不要把本地 resource cap 寫成 Server contract。

以上適用現有 React／Expo Web 前端，2026-10-04 核對瀏覽器原生 [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)／[getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)。純 lifecycle 測試不證明真裝置權限或音訊可用；Web、原生與正式 API 分別保留待驗項。

## 按任務讀取

| 本次改甚麼 | 只讀對應方法 |
|---|---|
| 主題／SVG／MD3 角色 | [theme-and-svg](references/theme-and-svg.md) |
| 日期／時間／表單／選單／Dialog | [forms-controls](references/forms-controls.md) |
| ScrollView／透明捲動條／模糊底板 | [scroll-and-blur](references/scroll-and-blur.md) |
| 手機軟件介面 | [native-ui](references/native-ui.md)；Web、bundle、實機分開 |
| 已採納的動效及其驗證 | 讀 [MOTION_SYSTEM](../../../MOTION_SYSTEM.md) 與 [motion-implementation](references/motion-implementation.md)；研究 MOTION_OPTIONS 不自動成為規範 |
| 照片、來源、模型 key、成長、摘要、聯絡等 | [功能交接](../../../HANDOFF.md#p2-coverage) 的正式差異與 API 指標；不用全部讀 |

## 最少必要畫面檢查

按變更驗受影響頁的 1440／1024／390／320 CSS px、鍵盤及相關操作狀態；共用外殼確有影響才擴至所涉路由，不例行全跑舊測試。分清 document overflow、內容裁切及可見焦點，展示必要實際畫面。

佈局／動畫改動驗初態、過渡和終態：沿該元件已採用的共用動畫進度同步相關尺寸／flex（新共用動效使用 Reanimated，勿機械改為另一套引擎），查看結束接縫、中途操作／離頁、減少動畫及受影響斷點。靜態前後截圖或 DOM phase 不證明連續過渡；來源定位與既有業務回調不應依賴動畫完成。已有適用方法可復用，工具能力不足便如實列未驗，不改驗收斷言。

命令及證據位置見 [WORKFLOW#preview](../../../WORKFLOW.md#preview)。只保存該版本必要截圖／trace／結果，不另建 Skill 日誌；每個結果列被測版本／manifest、環境、範圍及限制，失敗與補驗分開。高成本驗收及停批依 [根規則](../../../../AGENTS.md#finish)，不把方法文件當授權。

## 已有來源及驗證範圍

方法來源沿用既有研究，未在本次文件整理重跑產品或重新核對套件：RHF 7.88.0／resolvers 5.9.1／Zod 4.5.4 的採用理由見 [TECH_REUSE](../../../../docs/TECH_REUSE.md)。動畫／元件抽取沿 [Expo 動畫](https://github.com/expo/skills/blob/13ad8e05874195633b5c185f6947bb6400e228fc/plugins/expo/skills/expo-animation/SKILL.md)、[Expo 元件組裝](https://github.com/expo/skills/blob/13ad8e05874195633b5c185f6947bb6400e228fc/plugins/expo/skills/expo-design-system/SKILL.md)、[React state／key](https://react.dev/learn/preserving-and-resetting-state) 的既有核對。官方方法不是本項目實測保證；本地結果按 [指定包證據](../../../HANDOFF.md#history) 判斷，未驗條件仍待驗。

技術基線：Expo 57.0.24、Expo Router 57.0.22、React Native Web 0.21.2、React Native Paper 5.15.3；最後核對 2026-09-29。官方文件已核對：[Expo Router 檔案規則](https://docs.expo.dev/router/basics/core-concepts/)、[Expo Router layout](https://docs.expo.dev/router/basics/navigation-layouts/)、[Expo project-structure skill](https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-project-structure/SKILL.md)、[Expo design-system skill](https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-design-system/SKILL.md)、[Paper theming](https://oss.callstack.com/react-native-paper/docs/guides/theming)、[Paper icons](https://oss.callstack.com/react-native-paper/docs/guides/icons)。本項目的實作與驗證證據見 [HANDOFF.md](../../../HANDOFF.md)；官方文件核對不等同正式 API 驗收。
