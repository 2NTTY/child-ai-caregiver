---
name: web-screen-delivery
description: 在育有方 frontend/ 隔離 Expo 工程中，依參考圖實作或審核 Web／手機介面、共用 Paper 表單、語意動效、操作狀態及交接；不適用 Server／Agent 接線或正式 Android 真機驗收。
---

# 育有方 Web 畫面交付

保存本域可復用的實作與检查方法。工作次序／版本核對用 [WORKFLOW](../../../WORKFLOW.md)，當前包／授權／未驗用 [PLAN](../../../PLAN.md#active)，呈現取捨用 [DESIGN_SYSTEM](../../../DESIGN_SYSTEM.md)。業務契約及特定接線差異只沿 [HANDOFF 索引](../../../HANDOFF.md#p2-coverage) 讀本次功能，不在 Skill 維護第二份。

<a id="decision-routing"></a>
## 從任務選擇呈現與控制項

產品目的與適用範圍的唯一來源是 [DESIGN_SYSTEM：產品目的](../../../DESIGN_SYSTEM.md#user-first-principles)、[頁面責任](../../../DESIGN_SYSTEM.md#function-specific-layouts)及[操作角色](../../../DESIGN_SYSTEM.md#control-roles)。本節只把原則轉成實作判斷，不另列一套產品需求。

- 修改前先確定本頁主要任務、正在操作的資料 owner、最常用的動作及其風險。先找既有直達入口；不要為了套用共用頁面或元件，再包一層入口或表單。
- 按主操作、次要操作、輕量工具、disclosure 或 navigation 選現有配方；資料／回調／可及性行為可共用，不強迫所有 Pressable 共用邊框及背景。若改共用預設，先辨認實際 consumers 的角色，不能靠全站加框再逐頁補透明例外。
- 普通低風險操作沿既有 callback 直達；危險操作沿該功能的確認範圍與契約，可逆操作沿原 owner 的撤銷／恢復，不在畫面另存一份「撤銷前資料」。正式能力未接通時保留不可用與短提示，不能用合成 handler 通過冒稱接通。

| 具體情境 | 實作判斷／須避免的反例 |
|---|---|
| 來源橫向捲動箭嘴、聊天輸入工具 | 用既有輕量配方，透明無常態框仍保留可見圖示、命中區、focus／按壓／停用與讀屏名稱；不能為統一 AppButton 而把每個箭嘴框起來 |
| 具名的重要確認 | 使用清楚的主操作及真實風險語義，保留對象／範圍與必要確認；不能把輕量工具的透明樣式套到最終確認，亦不能給所有普通操作多一個確認彈窗 |
| 手機記錄詳情 | 沿同一資料 owner 改成自然閱讀順序及可返回的詳情；不要把桌面兩欄只改 column 卻保留欄位分高，或為了共用而迫家長先去另一個資料管理頁 |

## 元件及狀態方法

- 文案整理先沿 production route → owner → renderer 核對狀態和可達性，不按「預覽／未接線」全域替換。依 [文案呈現原則](../../../DESIGN_SYSTEM.md#control-roles) 檢查 loading、真空白、失敗、部分／舊資料及 pending mutation；同義 badge／title／正文合併時保留讀屏名稱。重試必須呼叫該資料 owner，不能只改文案掩蓋卡住的 loading；實際寫入不可保留模擬標籤。

- 沿用 Expo Router：app/ 只作路由／layout，src/screens/ 放畫面，src/components/ 放共用呈現，src/theme.ts 放 tokens，src/preview/ 放合成資料及控制器。樣式用共置 StyleSheet；不要因新版模板搬路由根。Portal 內需用的 scope 資料／回調由擁有者傳入，避免越出 provider 後再讀 context。
- `Link asChild`／`PreviewLink` 下的 Pressable 不直接傳函式型 `style`：本機 Expo Router 57.0.22 經 Radix Slot 以物件展開合併 style，會丟失 callback 的布局。傳 `StyleSheet.flatten` 後的實際物件；需按壓外觀時以局部 press-in／out 狀態產生物件，保留 href／guard／鍵盤語意。2026-10-05 已讀安裝版 BaseExpoRouterLink／ui/Slot 及 Radix 原碼並以 SSR 重現；仍須在受影響頁看實際橫排、padding、邊界及焦點，document 不溢出不等於元件排版正確。版本改變時重核，不擴成所有 Pressable 的禁令。
- 復用 Paper 5.x 及現有 App* 薄封裝。RN Web 0.21.2 的 accessibilityState 不等於 DOM 狀態；選單／勾選／Tabs 明確核對 aria-expanded／checked／selected 及鍵盤操作。AppDialog 以 RN Modal 承載 Paper Dialog，保留焦點限制、Escape 及返回焦點；Web 選單選取後若要捲動／聚焦選單外內容，用 AppSelect.onSelectionClosed 等 Modal 釋放焦點限制後執行，取消不跳轉，scope／權限／檔案版本更換時清除過期選取，不加猜測 timeout（2026-10-05 成長章節 320px 已補驗）。細節按下表讀。
- 重要表單沿已採用 RHF／Zod，以 Controller 接 Paper，原文不經 trim／數字轉換覆蓋。動態列用 stable id 保留草稿／基準。pointerdown 的 blur 驗證若令按鈕位移，須驗完整 pointer 提交，不能只用程式 click 或焦點斷言；沿既有 onSubmit／onChange 重驗方法，勿加無依據 timeout。
- view model／回調只呈現合法狀態，不決定授權或重試。網絡可用不是已保存；unknown 必須按該功能的正式契約處理，有收據與無收據的直接操作不可共用假重試器。身份／孩子／Server 變更清理邊界依專項交接，不從畫面或文字猜業務。
- 共用聊天維持 message id、最終快照、每訊息來源／展開狀態及本人跟隨意圖；不把合成 timer 當真 stream、不把已載入視窗當完整歷史。只呈現公開活動，不能顯示內部思維鏈。
- 同類呈現已重用時才抽小型共用元件，資料／回調和內容組裝分開；不把 fixture／控制器搬進通用顯示層。多實例 state／key 要按本人／孩子正確隔離。來源底線、捲動條、固定 composer 等相鄰元素須量度相對位置，不只檢查整頁寬度。

<a id="layout-lifecycle"></a>
## 版面及生命週期易錯點

以下是現有 React／RN Web 預覽中已遇到的局部陷阱；只套用至有相同條件的改動，不成為全站機械重構理由。

- **桌面百分比欄寬**：記錄展開的列表／詳情已有明確比例時，不再用後置 `flex: 0` shorthand 覆蓋欄位的 sizing。先核對合併後 style 與 computed width／flex-basis，再保留需要的 width 或個別 grow／shrink；量兩欄實際寬度及比例，不以沒有 document overflow 判定正確。
- **手機自然高度**：桌面 row 的欄位可需要伸縮，轉成 column 後，原話／Agent 理解等閱讀區不沿用 `flex: 1` 分配整段高度。按軸重設 sizing，檢查內容自然高度、區塊間距及整體閱讀焦點；不得靠刪除核對資料或固定小高度掩蓋大空白。
- **scope-key 與動效邊界**：把資料 owner 的 scope 重設與頁面／動效外殼分開。不能以 scope key 重掛整站，繞過既有 motion 邊界或丟失同 scope 的局部展開、閱讀位置及草稿；只在必要 owner／子樹重設。保留狀態不是跨孩子共用狀態：孩子、身份或權限變更仍按既定邊界清除資料／閱讀錨點、取消副作用，並拒絕遲到回呼。

掛載邊界限制不代表任何白閃的根因已定位。沒有對應版本的時序／畫面證據時，白閃原因及修復效果仍列待驗；不要從「換 key 可能 remount」直接寫成已證實原因。

## 多入口與快捷輸入的復用方法

- 新入口只接既有 callback／同源投影，不建立可獨立寫入的副本。移動 controller 到共同祖先時，分清需保留的集合、離頁要丟棄的 transient 草稿及 pending／unknown 鎖定；掛載及清理邊界沿[生命週期方法](#layout-lifecycle)。
- 跨入口同源須列明唯一掛載點、consumers 與 scope。scope mismatch 先不暴露舊資料，遲到回呼以 generation／scope 比對拒絕；欄位名稱相近不等於同一業務來源，不能將 MemoryTopic 改名當 Growth concern。
- 手勢只選擇輸入方式，不自動送出。按下後曾超過拖曳閾值，即使拖回起點也須抑制後續 click；抑制旗標須跨 scope／路由 effect 重建保留，消耗一次後清除，新實際 pointerdown 或鍵盤啟用才能恢復正常點按；pointercancel、失焦、隱藏、離頁及換 scope 清理。保留直接按鈕與鍵盤等效操作，安全區與底欄預留空間按實際畫面驗證。
- 本地 media adapter 的權限請求只由明確動作啟動；取消後遲到串流也須 stop tracks。錄音停止要等 final dataavailable，記錄真正 MIME，object URL 所有權只能轉移一次，所有結束路徑都釋放。能力、限制及正式接線看 [助手交接](../../../AGENT_HANDOFF.md#mobile-quick-input-design)，不要把本地 resource cap 寫成 Server contract。

以上適用現有 React／Expo Web 前端，2026-10-04 核對瀏覽器原生 [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)／[getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)。純 lifecycle 測試不證明真裝置權限或音訊可用；Web、原生與正式 API 分別保留待驗項。

## 按任務讀取

| 本次改甚麼 | 只讀對應方法 |
|---|---|
| 主題／SVG／MD3 角色 | [theme-and-svg](references/theme-and-svg.md) |
| 按鈕／輕量工具／disclosure／navigation | 先按[操作角色](../../../DESIGN_SYSTEM.md#control-roles)選型，再沿[實作判斷](#decision-routing)核對；涉及鍵盤／確認讀 [forms-controls](references/forms-controls.md) |
| 日期／時間／表單／選單／Dialog | [forms-controls](references/forms-controls.md) |
| 列表／詳情、row／column、scope owner 或重掛載 | [版面及生命週期](#layout-lifecycle)，再沿下節挑受影響路由驗證 |
| ScrollView／透明捲動條／模糊底板 | [scroll-and-blur](references/scroll-and-blur.md) |
| 手機軟件介面 | [native-ui](references/native-ui.md)；Web、bundle、實機分開 |
| 已採納的動效及其驗證 | 讀 [MOTION_SYSTEM](../../../MOTION_SYSTEM.md) 與 [motion-implementation](references/motion-implementation.md)；研究 MOTION_OPTIONS 不自動成為規範 |
| 照片、來源、模型 key、成長、摘要、聯絡等 | [功能交接](../../../HANDOFF.md#p2-coverage) 的正式差異與 API 指標；不用全部讀 |

<a id="verification-routing"></a>
## 最少必要畫面檢查

只驗本次改動及其直接影響的路由，按既有授權在受影響頁核對 1440／1024／390／320 CSS px、鍵盤及相關狀態；共用外殼確有影響才擴至所涉路由，不例行全站回歸或重跑所有舊測試。沒有 document overflow 或 handler 有回應，只證明其中一項，不能代替尺寸、比例、留白、視覺掃讀及實際完成路徑。

| 改動範圍 | 最少必要驗收路徑 |
|---|---|
| 控制角色／入口 | 在真正 consumer 畫面找出主要下一步，實際點按及鍵盤啟用；核對輕量工具未被加框、主確認可辨認、disclosure 展開／收合及停用／focus 語義，常用操作沒有多出中介入口 |
| 列表／詳情或響應式版型 | 選中→展開→收合→重開；桌面量兩欄尺寸／比例，手機看自然內容高度、順序與空白；詳情返回保留同 scope 的篩選／列表位置，切孩子後不殘留上一位的資料 |
| 同源 owner／scope／動效外殼 | 在受影響入口間返回，核對同一項資料的狀態一致、同 scope 局部狀態按設計保留；切孩子或撤權後沿安全邊界清理，遲到結果不再入畫；檢查原有轉場初態、過渡與終態仍經過正確邊界 |

必要截圖同時呈現正文與相鄰控制，分清 document overflow、局部裁切及可見焦點。文件整理或靜態案例自檢只驗規則是否可執行，不算產品畫面、動效、正式接口或裝置驗收。

佈局／動畫改動驗初態、過渡和終態：沿該元件已採用的共用動畫進度同步相關尺寸／flex（新共用動效使用 Reanimated，勿機械改為另一套引擎），查看結束接縫、中途操作／離頁、減少動畫及受影響斷點。靜態前後截圖或 DOM phase 不證明連續過渡；來源定位與既有業務回調不應依賴動畫完成。已有適用方法可復用，工具能力不足便如實列未驗，不改驗收斷言。

命令及證據位置見 [WORKFLOW#preview](../../../WORKFLOW.md#preview)。只保存該版本必要截圖／trace／結果，不另建 Skill 日誌；每個結果列被測版本／manifest、環境、範圍及限制，失敗與補驗分開。高成本驗收及停批依 [根規則](../../../../AGENTS.md#finish)，不把方法文件當授權。

## 已有來源及驗證範圍

方法來源沿用既有研究，未在本次文件整理重跑產品或重新核對套件：RHF 7.88.0／resolvers 5.9.1／Zod 4.5.4 的採用理由見 [TECH_REUSE](../../../../docs/TECH_REUSE.md)。動畫／元件抽取沿 [Expo 動畫](https://github.com/expo/skills/blob/13ad8e05874195633b5c185f6947bb6400e228fc/plugins/expo/skills/expo-animation/SKILL.md)、[Expo 元件組裝](https://github.com/expo/skills/blob/13ad8e05874195633b5c185f6947bb6400e228fc/plugins/expo/skills/expo-design-system/SKILL.md)、[React state／key](https://react.dev/learn/preserving-and-resetting-state) 的既有核對。官方方法不是本項目實測保證；本地結果按 [指定包證據](../../../HANDOFF.md#history) 判斷，未驗條件仍待驗。

技術基線：Expo 57.0.24、Expo Router 57.0.22、React Native Web 0.21.2、React Native Paper 5.15.3；最後核對 2026-09-29。官方文件已核對：[Expo Router 檔案規則](https://docs.expo.dev/router/basics/core-concepts/)、[Expo Router layout](https://docs.expo.dev/router/basics/navigation-layouts/)、[Expo project-structure skill](https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-project-structure/SKILL.md)、[Expo design-system skill](https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-design-system/SKILL.md)、[Paper theming](https://oss.callstack.com/react-native-paper/docs/guides/theming)、[Paper icons](https://oss.callstack.com/react-native-paper/docs/guides/icons)。本項目的實作與驗證證據見 [HANDOFF.md](../../../HANDOFF.md)；官方文件核對不等同正式 API 驗收。
