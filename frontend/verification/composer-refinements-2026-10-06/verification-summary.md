# Composer 呈現修正：整合／建置證據

- 基線：final frozen v48；821 個 source／docs／evidence 檔案逐檔複製核對，readonly shared family type 在首次驗證前已備妥
- 已批准 patch：5 個呈現 runtime 檔案＋1 個定向測試；zero-fuzz 套用，所有 before／after SHA-256 與 owner 最終來源一致，沒有手動改 runtime 或斷言
- 呈現：24px panel radius、淺色邊界、4×8 padding；工具間距 0、40／48 hit target；36px 無常態外框送出圓，只在本身作 hover／press 回饋；48–168 input limits 與 stable DOM 保留
- 本整合 combined typecheck、304/304 aggregate、唯一 fresh export 37 routes 均首輪通過
- Source／build-input fingerprint：`0cbda1c53061d573b6cca5b3e1b8af294c3762059aaf275e5c96e450fe330e76`
- Export fingerprint：`3c9e0c501ae18a8372281d48a36faae75ea8b45f4837bce6e7616ed8f81a6102`
- Entry：`_expo/static/js/web/entry-3e2f8d0fc2f8a09690edb0560b8a9fe3.js`；SHA-256 `b71b3547174551bdd85320779db12caf2832cd48f75ca723fc2677742aa24fbe`
- 凍結至建置完成沒有來源漂移；381 份歷史／v48 QA 證據及全部 assets 原樣保留。Hero PNG 在 source／export 均為 `2d6831182f397c2388f0f6239be093b7480eef2c70fe4ff4894cdcb1dee13c29`

完整 diff 見 `combined-source-docs.patch`，包括主模型親寫的 DESIGN_SYSTEM／PLAN／STATUS；逐檔來源與輸出見 `source-manifest.json`、`export-manifest.json`，原命令及 logs 見 `checks.json`。

## 已知證據限制

Owner 初次 isolated typecheck 因缺 sibling family type 失敗，原完整 stdout 未保存；`contributors/composer-presentation/checks.json` 的原缺漏記錄及修正後 passing log 保留，沒有補造原 log。本整合因一開始已複製相同 readonly type，首次 typecheck 即通過。

本執行者沒有 browser、Git 或 Sites 操作，也没有生成圖片或新增 assets。Composer 的實際幾何、IME／autosize／焦點／發送手勢仍待本修訂限定 browser 驗證；舊 v48 QA 不代表這個新 composer 已通過。任何原生裝置、真媒體／模型／傳送及逐幀無閃動均不在此結果內。

## 主模型接受的後續 v49 畫面結果

主模型已親讀 browser report 並查看實際桌面截圖，接受已執行範圍通過：1180／390／320 的面板與控制幾何、多行上限／內部捲動、Tab 焦點、同孩子草稿保留／換孩子重設，以及手機 send 局部 hover。Live entry 與本次 export 一致。send 持續按住／放開、正常 Enter submit、IME composition、原生與逐幀穩定性沒有新實測，不列為通過。原 approval-denied、無效 outer-frame 量度及 string-function helper 失敗保留；只有後續有效 frame-scoped 量度支持窄屏結論。沒有提交文字、預覽回覆或媒體操作，結束時草稿已清空、send 停用。

完整範圍及限制依 `browser-qa/v49-browser-report.md` 與 `v49-summary.json`；這是 browser owner 的證據，本整合執行者沒有操作 browser。
