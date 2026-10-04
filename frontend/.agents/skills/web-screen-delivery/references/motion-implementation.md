# 動效接合與驗證

只在改動相關接點時讀對應段落。體驗要求以 [MOTION_SYSTEM](../../../../MOTION_SYSTEM.md) 為準；本檔保存可復用方法，不維護第二套進度。

適用版本：React／ReactDOM 19.2.3、RN 0.86.3、RN Web 0.21.2、RHF 7.88.0、Paper 5.15.3、Paper Dates 0.24.0。最後核對：2026-10-04。版本不符或實際行為衝突時，只重核受影響 API。

## 捲動與焦點

- RN Web 的 ScrollView 會覆寫返回 host node 的 `scrollTo` 為 RN 方法。透過 RN ref 使用 `scrollTo({ x, y, animated: false })`；把該節點轉型成 HTMLElement 不會恢復原生 DOM 簽名。把 `top/left/behavior` 傳給被覆寫的方法會遺失 `animated:false`，造成非預期平滑捲動。來源切換保持 viewport 穩定，只移動唯讀內容；分開驗已停止及捲動中切換的回頂。
- 自訂 portal 若在 layout-effect cleanup 返回焦點，可能被 React 後續的 selection restoration 覆蓋。先解除 trap／背景 inert 並保留返回意圖，再於關閉的 layout setup 聚焦仍有效的來源控制。不要用任意 sleep、全頁 focus hack 或延後解除背景鎖。
- RN Modal 的焦點生命週期另計：保持 Modal 節點穩定，以 visible 關閉，必要時在受 scope／來源有效性保護的 onDismiss 返回欄位。不要把自訂 portal 的做法機械套到 RN Modal。
- 退出動畫保留的節點可以仍在 DOM，但須立即離開互動、鍵盤及可及性範圍；分開核對視覺退出與焦點／pointer ownership。

## 動態表單與清單

- RHF append 的預設 focus intent 可能在 MotionList 延後掛載 Controller 前已消耗。需要時為該次 append 保存 scoped 意圖，以 stable field.id 對應實際提交的新 ref，消耗一次；不對每次 mount 自動聚焦。
- 刪除或移位後，按提交後狀態選焦點目標：原先 enabled 的移位按鈕可能已 disabled。保留其他列草稿、選取及載入前綴；FLIP 只管位置，不重新分頁、排序或新增業務動作。
- readonly 與 disabled 不等價。更新唯讀結果時，若既有契約要求保留輸入焦點／選取，沿 readOnly／editable=false 的適用語義，不任意 disabled。幕布不保留 live Controller、操作鈕或動態資格警告。

## 必要驗證及追溯

- 量測初態、中途、終態及必要中斷。同步幾何共用一個進度；停穩截圖不能證明首個可見幀無閃動。先失敗即停該批次查因，修復後局部補驗。
- 活躍 RN Web tabpanel 可能省略 aria-hidden。以 `:not([aria-hidden=true])` 加上唯一活躍面板、實際可見及預期 accessible label 判定，不只匹配字面 false。相同 rendered id 也不等於同一 DOM instance。
- 綁定 source／export manifest、bundle hash、實際網址及 viewport。測試檔專用修改與產品 bundle 修改分開；受影響的新來源不能沿用舊版通過結果。語法解析不能替代整合 typecheck，例如此 RN 版本的 StyleSheet 型別沒有 absoluteFillObject。
- 分開陳述 build、runner 實際執行、CUA、站內手動減少動畫、系統媒體偏好、原生真機及讀屏。自然載入／快取重載不能證明受控慢載或失敗網絡路徑。
- 成熟控件先核對自身動效。Paper Dates 0.24.0 的內部模式切換仍有無公開 reduce prop 的 250 ms 動作；外層動畫驗收不能自動關閉該缺口。不 fork vendor 掩蓋限制。

套件事實核對入口：安裝版本的 `react-native-web/dist/exports/ScrollView/index.js`（scrollTo 與 _setScrollNodeRef）、`react-dom/cjs/react-dom-client.development.js`（mutation／selection restoration／layout 次序）、`react-hook-form/dist/index.esm.mjs`（append／focus intent）。官方入口及既有研究沿 [捲動](scroll-and-blur.md)、[表單](forms-controls.md)，不複製整份手冊。

歷史與當次證據只在需要時讀 [FE-W37 交接](../../../../HANDOFF.md#semantic-motion) 所列的具體結果。恢復來源與工具記錄重建摘要見 [恢復驗證索引](../../../../verification/fe-w37-motion/recovery-2026-10-04/README.md)；歷史結果、失敗、目前未驗項分開，不把重建摘要冒充保存完好的原始 log。
