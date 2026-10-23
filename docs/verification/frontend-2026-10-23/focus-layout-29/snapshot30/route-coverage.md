# 18-route 分層覆蓋矩陣

18個page entries＝17一般／家長入口＋1既有管理gate。既有source trace基線與本次scope分開；source閱讀／定向tests不等於browser。沒有用29照片補30。

|Route|用途|本次來源範圍（含29）|30產品增量|30 browser|
|---|---|---|---|---|
|/login|登入|無本輪產品改動|29來源保留；無30專屬產品增量|本批30未重驗；不以29圖或共用元件測試當此route全驗。|
|/|首頁|共用導航排序；非首頁重設計|29來源保留；無30專屬產品增量|本批30未重驗；不以29圖或共用元件測試當此route全驗。|
|/chat|聊天|已載空 snapshot 與 focus 刷新|29來源保留；無30專屬產品增量|本批30未重驗；不以29圖或共用元件測試當此route全驗。|
|/tasks|待辦|loaded-ID 原子範圍刷新|新增TaskContent metadata；loaded-ID owner保留|有界PASS：390/1440 metadata；390合法兩頁自然focus／詳情／關閉回列。1440自然focus遭Chrome code9，未知。|
|/growth|關注／準備|共用 Tabs 量測；主內容未改|新增關注時間線／準備單metadata|有界PASS：關注／準備metadata390/1440、來源／版本disclosure；真來源到Care與關閉回焦。|
|/summary|概況／成長檔案|空 snapshot、已套用期間；共用 Tabs|29來源保留；無30專屬產品增量|RED：未套期間／日期與week讀取保留；nativefocus後+538ms失焦至BODY，tab/marker位移31.25CSSpx約276ms。|
|/care|核對|已保存正文優先；count／empty／page／detail focus|新增proposal／Care詳情及確認時間metadata；29focus owner保留|有界PASS：Care詳情／歷史比較390/1440；null數量主讀省略、舊版本缺失保留；合成memory_fact提案390/1440。不重稱29focus場景全重跑。|
|/memory|記憶|loaded-ID 原子範圍刷新；共用 Tabs|新增事實內容／來源metadata、安全來源link及disclosure；loaded-ID owner保留|有界PASS：390合法3+2頁自然focus保留第四來源展開與row身份；1440版面／追溯；topics空終頁。本人短標籤尚未全統一。|
|/history|歷史|待辦單欄；核對／記憶／待辦已載範圍；共用 Tabs|待辦單欄保留；共用TaskContent／Care／Preparation／Growth閱讀受30增量影響|有界PASS：共用TaskContent／Care／Preparation／Growth代表閱讀；29單欄歷史全部操作並非30全重跑。|
|/settings|設定|模型／通知／備註；草稿／確認依據／focus；共用 Tabs|29來源保留；無30專屬產品增量|有界PASS：通知審閱→自然focus→取消；審閱期間fields/focus保留，取消後GET才執行。取消焦點BODY不算回焦PASS；其他設定未30重驗。|
|/more|全部功能|管理導航排序／既有入口|29來源保留；無30專屬產品增量|本批30未重驗；不以29圖或共用元件測試當此route全驗。|
|/profile|檔案|導航排序；內容未改|29來源保留；無30專屬產品增量|本批30未重驗；不以29圖或共用元件測試當此route全驗。|
|/photos|照片|無本輪照片能力改動|29來源保留；無30專屬產品增量|本批30未重驗；不以29圖或共用元件測試當此route全驗。|
|/sources|來源|readFresh 與寫入鎖；同 scope 讀取|29來源保留；無30專屬產品增量|本批30未重驗；不以29圖或共用元件測試當此route全驗。|
|/contact|聯絡|無本輪產品改動|表單schema既有native_push與max3對齊|有界PASS僅503明確讀取失敗與一次人工重試；三渠道保存／綁定未browser驗收。|
|/family|家庭|無本輪產品改動|29來源保留；無30專屬產品增量|本批30未重驗；不以29圖或共用元件測試當此route全驗。|
|/guide|指引|無本輪產品改動|29來源保留；無30專屬產品增量|本批30未重驗；不以29圖或共用元件測試當此route全驗。|
|/admin|管理員|既有 gated 入口，無本輪改動|29來源保留；無30專屬產品增量|不屬一般家長browser範圍；既有gate未改。|

29歷史browser結果另見[機器可讀矩陣](route-coverage.json)中的snapshot29Browser欄及[29原報告](../route-coverage.md)，不是30重新執行。所有fullTS、正式服務、無入口與未跑分支限制仍有效。
