# 育伴港選配工作台｜第 94 題：教材影音片段

換教材時，舊選擇和預覽會清空，並重新讀取該卡的版本及影音設定；教材原文可另開。只可從既有片段按起訖時間和原文挑選，不改寫文字，也不自行剪片。有有效草稿才可加入；同一來源證據、同一起點不重複加入。「加入」只改畫面上的草稿。核對時間、關鍵字和適用情況後，另按匯入才建立草稿版本；版本比較與獨立審核是後續步驟，匯入不等於發布。本工作台只供選配，不更改逐卡影音設定，也不匯入或發布。

[育伴港固定原版：教材影音、草稿、匯入與獨立審核](https://github.com/2NTTY/child-ai-caregiver/blob/2f552cf35ef8dc536b08bdfb77a3fd0feb00aeff/frontend/src/components/admin/AdminPlatformCards.tsx#L49-L111)

## 94A 教材片段-01｜Adobe Premiere：先讀逐字稿，再看選了哪些段落

借用 Paper Edit 把已選段數、總時長和預覽放在一起的方式，方便核對後才加入草稿。育伴港選的是現成片段，不像 Premiere 可自由選字組成影片。

[作者原頁](https://helpx.adobe.com/premiere/desktop/edit-projects/edit-video-using-text-based-editing/create-a-sequence-with-paper-edit.html)

Premiere 26.5，Paper Edit 指南 2026-09-09。整頁圖屬 2023-04-13 的介紹，不是 26.5 的操作畫面；26.5 原圖只顯示局部。

示例影片素材的轉載權未核實，只連結 Adobe 原頁與原圖。

- [Adobe 官方整頁原圖：逐字稿、預覽與時間軸（2023，非 Paper Edit）](https://blog.adobe.com/en/publish/2023/04/13/media_1dba2f6256346a4ddbde06b6745fead94d4e0e9cc.jpg?format=jpg&optimize=medium&width=750)
- [Adobe 官方介紹：2023 文字剪輯工作區](https://blog.adobe.com/en/publish/2023/04/13/nab-2023-introducing-text-based-editing-premiere-pro-properties-panel-after-effects-more)
- [Adobe 26.5 局部原圖：已選段數、時長、Preview 與 Create](https://uploads-us-west-2.insided.com/adobedme-en/attachment/a0d6f855-5037-4f19-94d1-221ca047267d.jpg)
- [Adobe 官方 26.5 發布說明：Paper Edit](https://community.adobe.com/announcements-727/what-s-new-in-adobe-premiere-26-5-september-2026-1641187)
- [育伴港固定版本：切換教材、選既有片段、加入草稿](https://github.com/2NTTY/child-ai-caregiver/blob/2f552cf35ef8dc536b08bdfb77a3fd0feb00aeff/frontend/src/components/admin/AdminPlatformCards.tsx#L49-L111)

## 94B 教材片段-02｜Kdenlive：先看時間範圍，再收進片段清單

來源監看器標出時間範圍，另一步才把片段收進素材箱。育伴港可用相同的先後次序：先看既有片段的起訖和原文，再決定是否加入；不提供拖動剪點、剪片或輸出影片。

[作者原頁](https://docs.kdenlive.org/en/user_interface/monitors/clip_monitor.html#creating-zones)

Kdenlive 手冊 26.08；整頁及局部原圖的檔名分別標示 23.04、25.12，不是同一版本的連續操作畫面。

保留 Kdenlive 手冊、授權頁及原圖連結，未轉載。

- [Kdenlive 官方整頁原圖：素材箱、來源與專案監看器、時間軸](https://docs.kdenlive.org/en/_images/kdenlive2304_ui-workspaces.webp)
- [Kdenlive 官方局部原圖：標號 3 是已選時間範圍](https://docs.kdenlive.org/en/_images/ui-monitors_clip-monitor-elements_2512.webp)
- [Kdenlive 官方手冊：工作區各區用途](https://docs.kdenlive.org/en/user_interface.html)
- [Kdenlive 手冊署名與授權](https://docs.kdenlive.org/en/more_information/credits_and_license.html)
- [育伴港固定版本：片段加入的是草稿，不是發布版本](https://github.com/2NTTY/child-ai-caregiver/blob/2f552cf35ef8dc536b08bdfb77a3fd0feb00aeff/frontend/src/components/admin/AdminPlatformCards.tsx#L49-L111)

## 版本與檢查

- 94 題、191 款、114 款外連，保留 146 張原圖。新兩款的原圖只連結，沒有轉載。
- 完整離線版：31,039,946 bytes，SHA-256 `1709d4dc5bd7eb263e94c62ab85ab69e7fbb6f8f77e7762f70d182068db31fae`。
- 靜態與離線 JS 模擬檢查涵蓋選題、比較、複製和搜尋。未執行實際瀏覽器、剪輯、草稿匯入或發布。
- 本分支只備份來源與版本，不開 PR、不改主線、不改線上預覽。
