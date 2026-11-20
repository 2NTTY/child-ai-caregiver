# 育伴港選配工作台｜第 99 題：減少動畫

- **99A 在系統設定交代影響範圍**：[elementary OS 7 固定原圖](https://github.com/elementary-Inc/blog/blob/4a8b85e7df2eacf6bfbb231934f587856ecc5095/images/updates-for-april-2023/settings-appearance.png)，2202 × 1538，blob `df739ffb00d3b0ee86f029fa9bc9e52b5f2ca336`。Desktop → Appearance 把 Reduce Motion 與色彩等項目分開，說明影響視窗管理員及部分介面。開關顯示關閉，不是鎖定。Danielle Foré／elementary, Inc.，[原作者 2023-05-05 發布文](https://blog.elementary.io/updates-for-april-2023/)，原圖未改，[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)。
- **99B 在 App 內顯示跟隨誰**：[Zeron 固定原圖](https://github.com/zeronsh/zeron/blob/3d2f1e64af3b40ec1354ca199fbe439c666f3681/docs/media/smooth-scroll/settings-light.png)，2000 × 1440，blob `589977aea9df2edd48eb0c2e7feec1f92def6fcd`。外觀頁顯示 System 與當時的狀態「系統允許動畫」。[原作者擷取說明](https://github.com/zeronsh/zeron/pull/1005)，Copyright (c) 2026 Wing，[MIT](https://github.com/zeronsh/zeron/blob/3d2f1e64af3b40ec1354ca199fbe439c666f3681/LICENSE)全文隨原圖。來源的局部補圖只留連結，非另一款完整頁。
- [育伴港固定偏好程式](https://github.com/2NTTY/child-ai-caregiver/blob/c5334be942df12c672c15a2ebe653e9614998a58/frontend/src/components/appearance/MotionSettings.tsx#L11-L31)採系統優先；系統要求減動時站內不能開回動畫。兩張參考圖均不顯示育伴港的鎖定狀態，沒有改動任何設定。

99 題、201 款（114 款純外連）、156 張離線原圖。完整 HTML 32,458,450 bytes，SHA-256 `1b2e20410416d2845ca021febab2192b397a03e44509114e21481fb69c7a525c`。核對兩張原圖、原來源、許可、跳頁、搜尋、選擇、複製來源；保留既有 98 組和執行程式。未做瀏覽器／手機實機驗收；未建 PR、未合併、未發布。

`rebuild99.py` 是不含圖片副本的可重建增量。依序傳入 SHA-256 為 `e9de4d56ba052f1fee0b4eccaae59ca8eaba667192b87d800aab41c2ab3b7710` 的第 98 題完整 HTML，以及上方兩張固定原圖、新輸出檔名。腳本核對輸入及最終 SHA，不覆寫已有檔案；實際重建與成品逐 byte 相同。完整 HTML 另獨立私存。
