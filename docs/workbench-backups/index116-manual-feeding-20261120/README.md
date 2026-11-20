# 育伴港選配工作台｜第 98 題：手動記錄餵奶量

- **98A 一個奶量欄**：[Baby Record 固定原圖](https://github.com/runtime-exception/baby-record/blob/b40587871c702e340728dde67afde878f5b8c644/docs/%E5%96%82%E5%85%BB%E8%AF%A6%E6%83%85%E9%A1%B5.jpg)，960 × 1738，blob `ed83cd0fd5a3fe21257cdd1ac85edde8d3907744`。[固定程式](https://github.com/runtime-exception/baby-record/blob/b40587871c702e340728dde67afde878f5b8c644/apps/frontend/src/views/record/FeedingRecordView.vue#L22-L31)顯示奶類、時間及奶量是新建預設，不是已保存事件或餵奶指引。[原作者 MIT 聲明](https://github.com/runtime-exception/baby-record/blob/b40587871c702e340728dde67afde878f5b8c644/README.md#L253-L255)與標準英文條款一併保留。
- **98B 分開準備量、喝下量**：[Lotties 固定合成原圖](https://github.com/lotties-app/lotties.app/blob/47d9257d52437ea0ec53e05ee43e8d86f33a97f6/code/web/public/showcase/log-feed-light-en.webp)，780 × 1688，blob `5dfef0837d38fe646c0c1d1373f08c234b865ed9`。原圖顯示準備量及快捷選項，喝下量標題可見、大部分控件在下方，不把圖中的數字或提示當建議。[合成規則](https://github.com/lotties-app/lotties.app/blob/47d9257d52437ea0ec53e05ee43e8d86f33a97f6/docs/showcase-media.md#L3-L13)，[原作者 AGPL](https://github.com/lotties-app/lotties.app/blob/47d9257d52437ea0ec53e05ee43e8d86f33a97f6/LICENSE)，[第三方署名](https://github.com/lotties-app/lotties.app/blob/47d9257d52437ea0ec53e05ee43e8d86f33a97f6/CREDITS.md#L46-L53)。
- [育伴港現有表單](https://github.com/2NTTY/child-ai-caregiver/blob/c5334be942df12c672c15a2ebe653e9614998a58/frontend/src/components/care/CareRecordForm.tsx#L61-L90)仍是預覽再確認的共享照顧記錄。這兩款不是現有成品或保存結果，也不是第 74 題的期間合計。

98 題、199 款（114 款純外連）、154 張離線原圖。完整 HTML 31,963,929 bytes，SHA-256 `e9de4d56ba052f1fee0b4eccaae59ca8eaba667192b87d800aab41c2ab3b7710`。原圖 bytes、選擇、跳頁、離線搜尋和複製來源核實；保留既有 97 組與應用程式。未做實機瀏覽器或手機驗收；未建 PR、未合併、未發布。

## 重建
`rebuild98.py` 是增量備份，不含圖片副本。準備 SHA-256 為 `c38ca7d014e6f84c88a82ac211f33fc1eec2f8e589af6d39e14ced9dbcd877c9` 的第 97 題完整 HTML，以及上方固定的兩張原圖，按這個順序連同新輸出檔名傳給腳本。腳本核對三份輸入和最終 SHA-256，不覆寫既有檔案；已實際重建並逐 byte 核對。完整 HTML 另獨立私存。
