# 選配工作台第 105 頁：還原本人通知偏好前，先看哪段時間會靜音

本頁比較兩種整頁設計，不執行真實還原或通知。前 104 頁與舊選項完整保留；本版 105 個主題、213 款、165 張離線圖、117 款只外連。

- **A：目前與備份逐欄比。** [WordPress 官方 Classic Revisions 完整原圖](https://wordpress.org/documentation/files/2019/02/revisions-2-7.0.jpg)，圖檔標示 7.0。原圖展示兩份文章修訂及獨立還原入口，不是通知偏好或本人備份。WordPress Documentation Team；[文件圖片 CC0](https://make.wordpress.org/docs/licensing/)。原圖未改，商標不在授權內。
- **B：先看時區和跨夜影響，再核對原值。** [ENVY DESIGN 原作者案例 5](https://envydesign.jp/patterns/en/settings-notification-matrix/)，SET-008，2026-11-18，岡野優太。外連整頁桌面圖；手機圖是首屏補充。原案有過午夜的靜音時段及例外，不是還原畫面，不沿用它的早上批次派送。

[育伴港原碼](https://github.com/2NTTY/child-ai-caregiver/blob/573d29821035e74dc90be6d968788f48cedd6937/frontend/src/components/account/HandoverImportControls.tsx#L455-L473)：先只讀比較本人簽署備份和目前偏好，再以獨立動作還原整組，無逐欄合併。相同則略過；版本變更則留現況；沒有通知偏好的批次結果時顯示「等待處理」。[普通待辦和預約例外的時區規則](https://github.com/2NTTY/child-ai-caregiver/blob/573d29821035e74dc90be6d968788f48cedd6937/server/task-policy.ts#L38-L81)與聊天推播規則分開。時間線及參考時區換算是設計構想，不代表現有功能，也不保證通知的派送時間。

## 重建及驗證

分支只備份可重建文本，不含私人預覽或圖片檔。重建須有第 104 版獨立保存的 HTML（SHA-256 `4ffb3e4b01330afb264749f7aabdd9c4d3437512037e3885296077b27fbecce0`），以及上述官方 WordPress 原圖（以 `a-wordpress-classic.jpg` 命名，檔案雜湊見 spec）。執行 `python append105.py baseline104.html spec105.json output105.html`。

- HTML：34,297,699 bytes，SHA-256 `6ee6a45eb9743e5cd4f2dfa887e82e5cc828304b5c5a6e3b2f68ef866a697481`。
- 單檔 ZIP：22,745,141 bytes，SHA-256 `40f1868944ea4fa96020fb0333dd595d430fa30f56291f0bf82269fd2b0a90b1`。
- 離線定向檢查通過：既有資料、選項、搜尋及跳轉、對照與選擇、原圖及版本、複製來源。未更新線上站或四方案。
