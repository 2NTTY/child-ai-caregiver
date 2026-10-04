# FE-W37 恢復來源與驗證索引

2026-10-04 雲端工作區異常後，從已推送 PR #84 的 `e8a653ddfcc4dc88c35bef8bd6a45a9dfbb8e3fc` 恢復 332 個來源／配置／指引／資產檔，每檔核對 Git blob hash 及大小。未下載的歷史驗證檔仍在 GitHub，並未刪除。

## 需要時直接讀

- 工作區異常前、已推送的驗證：[手動減少動畫](https://github.com/2NTTY/child-ai-caregiver/blob/e8a653ddfcc4dc88c35bef8bd6a45a9dfbb8e3fc/frontend/verification/fe-w37-motion/manual-reduce-2026-10-04T07-43Z/cua-checks.json)；其餘舊證據沿 [原交接](../../../HANDOFF.md#semantic-motion) 的指定連結。這些只證明各自被測版本。
- e8 之後尚未提交的 CUA 工具記錄重建：[recovered-cua-summary.json](recovered-cua-summary.json)。這是從可用工具結果重建的摘要，不是原始 logs／screenshots 全數保存的證明；內含來源／bundle hash、已觀察成功、失敗及未驗界線。
- 長期方法：[動效接合與驗證](../../../.agents/skills/web-screen-delivery/references/motion-implementation.md)。不把本次事故、進度或一次性結果複製入 Skill。

## 恢復版驗收界線

未提交修改由原實作者按保留內容重建；只有能核對原 hash 的檔案才稱逐位元一致，其餘屬語意重建。重新取得 typecheck、必要純測試、Web／Android bundle 及受影響 UI 證據前，不沿用舊結果宣稱新版通過。

尚待新版驗證：來源捲動重設、首屏插畫 readiness／後備、灰幕同步淡入淡出、共用橫向箭頭、設定及記憶跨頁切入首幀，以及重建後其他受影響接合。Android bundle 不等於真機驗收；站內手動偏好不等於系統 reduced-motion；自然載入不等於受控慢速／失敗網絡測試。

本目錄不複製整個歷史證據庫。新檢查仍按既有 `verification/fe-w37-motion/<具體批次>/` 保存，只從交接連到所需結果；不可改寫旧結果為新時間。
