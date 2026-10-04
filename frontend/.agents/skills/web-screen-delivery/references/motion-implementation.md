# 動效接合與驗證

只在改動相關接點時讀對應段落。體驗要求以 [MOTION_SYSTEM](../../../../MOTION_SYSTEM.md) 為準；本檔保存可復用方法，不維護第二套進度。

適用版本：React／ReactDOM 19.2.3、RN 0.86.3、RN Web 0.21.2、RHF 7.88.0、Paper 5.15.3、Paper Dates 0.24.0。最後核對：2026-10-04。版本不符或實際行為衝突時，只重核受影響 API。

## 捲動與焦點

- RN Web 的 ScrollView 會覆寫返回 host node 的 `scrollTo` 為 RN 方法。透過 RN ref 使用 `scrollTo({ x, y, animated: false })`；把該節點轉型成 HTMLElement 不會恢復原生 DOM 簽名。把 `top/left/behavior` 傳給被覆寫的方法會遺失 `animated:false`，造成非預期平滑捲動。來源切換保持 viewport 穩定，只移動唯讀內容；分開驗已停止及捲動中切換的回頂。這是 RN ref／非 DOM fallback 的簽名規則；Web AnswerSources 另沿 owning realm 的 Element.prototype.scroll 呼叫原生 API，不能因 TypeScript cast 就假設節點仍是原生方法。原生 End momentum 的取消並未因此驗收通過，不能把當前兩次呼叫候選寫成通用已驗修法。
- 自訂 portal 若在 layout-effect cleanup 返回焦點，可能被 React 後續的 selection restoration 覆蓋。先解除 trap／背景 inert 並保留返回意圖，再於關閉的 layout setup 聚焦仍有效的來源控制。不要用任意 sleep、全頁 focus hack 或延後解除背景鎖。
- RN Modal 的焦點生命週期另計：保持 Modal 節點穩定，以 visible 關閉，必要時在受 scope／來源有效性保護的 onDismiss 返回欄位。不要把自訂 portal 的做法機械套到 RN Modal。
- 退出動畫保留的節點可以仍在 DOM，但須立即離開互動、鍵盤及可及性範圍；分開核對視覺退出與焦點／pointer ownership。

- 需要保留 Modal owner 以完成退出，不代表全部關閉的選單都要在頁面初次進入時建立 Portal。可在首次真正開啟前延後建立，開啟過後維持 owner 並由 visible 控制；局部核對首開、重開、取消及焦點，不把減少初始化自稱為已測得幀率改善。
- 捲動跟隨意圖不能只靠後續 scroll event 校正：已到底的 viewport 再按 End 沒有位移，不應因此停跟。只豁免確定的 viewport／底部無位移動作，不放寬巢狀來源或編輯欄位；輸入框增高而保持讀舊時，也要更新「回到最新」可見性。

## 動態表單與清單

- RHF append 的預設 focus intent 可能在 MotionList 延後掛載 Controller 前已消耗。需要時為該次 append 保存 scoped 意圖，以 stable field.id 對應實際提交的新 ref，消耗一次；不對每次 mount 自動聚焦。
- 刪除或移位後，按提交後狀態選焦點目標：原先 enabled 的移位按鈕可能已 disabled。保留其他列草稿、選取及載入前綴；FLIP 只管位置，不重新分頁、排序或新增業務動作。
- readonly 與 disabled 不等價。更新唯讀結果時，若既有契約要求保留輸入焦點／選取，沿 readOnly／editable=false 的適用語義，不任意 disabled。幕布不保留 live Controller、操作鈕或動態資格警告。

## 切頁幾何與圖片初態

- 先分清外殼高度／位置改變、欄數斷點改變、圖片晚出現及透明度動畫；不要把所有閃動都歸因於動畫。記錄變化前後的容器位置與尺寸，區分實測重排及只有源碼路徑的風險。
- 固定尺寸槽內交換內容時，保持外層幾何不變，以同一進度移動兩層；隱藏／退出層立即退出 pointer、鍵盤及可及性範圍，不能只設透明度。快速反轉從當前進度續接，範圍／尺寸／偏好改變及卸載時取消過時回呼；局部量度及 overflow 提示不得再次改變正文原點。需求對頂欄的具體安排沿 MOTION_SYSTEM，不在 Skill 保存第二份版面決策。
- 共用外殼在路由切換前確定必要空間；条件性資料列改變高度時，選擇一致佈局或同步幾何過渡，不用整頁淡出掩蓋。響應式先用可確定的 CSS／容器佈局；需要量度時在適用的 layout phase 取得實際內容寬，避免先按 viewport 猜欄數再修正。
- 圖片及其替代狀態保留明確尺寸／比例；全站首次載入 gate 不等於之後每次掛載圖片都已完成量度及呈現。核對返回頁面與暖載路徑，不為修正局部圖片而每次重啟全站 loading。
- 驗切頁時從其他頁進入，在受影響的窄尺寸／斷點觀察初態與中途，涵蓋必要的返回及快速切換。穩定終態和離散採樣只能證明所見狀態，不宣稱連續首幀零閃動。

## 必要驗證及追溯

- 量測初態、中途、終態及必要中斷。同步幾何共用一個進度；停穩截圖不能證明首個可見幀無閃動。先失敗即停該批次查因，修復後局部補驗。
- 活躍 RN Web tabpanel 可能省略 aria-hidden。以 `:not([aria-hidden=true])` 加上唯一活躍面板、實際可見及預期 accessible label 判定，不只匹配字面 false。相同 rendered id 也不等於同一 DOM instance。
- 多個隔離預覽工作區共用 node_modules 時，須隔離實際 Metro cache。Expo 57 的此設定使用 `os.tmpdir()/metro-cache`，只設 XDG_CACHE_HOME 不足；各工作區以專用 TMPDIR 建置。若已證實路由轉換快取混用，保留失敗產物後在新專用 TMPDIR 做一次 `expo export --clear`，不靠修改 JSX 或硬編碼別的 app root 掩飾。核對 `_ctx` 的 require.context 指向本次工作區，再核對產物包含必要路由／功能模組及實際畫面；來源雜湊不等於打包圖使用了該來源。這是共用依賴的多工作區條件，不要求一般單工作區每次清快取。
- 綁定 source／export manifest、bundle hash、實際網址及 viewport。測試檔專用修改與產品 bundle 修改分開；受影響的新來源不能沿用舊版通過結果。語法解析不能替代整合 typecheck，例如此 RN 版本的 StyleSheet 型別沒有 absoluteFillObject。
- 分開陳述 build、runner 實際執行、CUA、站內手動減少動畫、系統媒體偏好、原生真機及讀屏。自然載入／快取重載不能證明受控慢載或失敗網絡路徑。
- 成熟控件先核對自身動效。Paper Dates 0.24.0 的內部模式切換仍有無公開 reduce prop 的 250 ms 動作；外層動畫驗收不能自動關閉該缺口。不 fork vendor 掩蓋限制。

套件事實核對入口：安裝版本的 `react-native-web/dist/exports/ScrollView/index.js`（scrollTo 與 _setScrollNodeRef）、`react-dom/cjs/react-dom-client.development.js`（mutation／selection restoration／layout 次序）、`react-hook-form/dist/index.esm.mjs`（append／focus intent）。官方入口及既有研究沿 [捲動](scroll-and-blur.md)、[表單](forms-controls.md)，不複製整份手冊。

歷史與當次證據只在需要時讀 [當前包](../../../../PLAN.md#active) 所列的具體結果。恢復來源與工具記錄重建摘要見 [恢復驗證索引](https://github.com/2NTTY/child-ai-caregiver/blob/fa696d60ef390383ddf049b4dfba54bd2069e81a/frontend/verification/fe-w37-motion/recovery-2026-10-04/README.md)；歷史結果、失敗、目前未驗項分開，不把重建摘要冒充保存完好的原始 log。
