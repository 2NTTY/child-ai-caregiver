# 第 55 題：更正已存照顧記錄：回看改動，處理版本衝突

## 育伴港原始碼基準

以 `36434a235458646f8398229628e67f8ca5316bac` 的原始碼核對：[照顧頁詳情入口](https://github.com/2NTTY/child-ai-caregiver/blob/36434a235458646f8398229628e67f8ca5316bac/frontend/src/screens/careScreen.tsx#L155-L166) 接受 `/care?record=<id>` 或 `recordId`；[已保存的記錄詳情](https://github.com/2NTTY/child-ai-caregiver/blob/36434a235458646f8398229628e67f8ca5316bac/frontend/src/components/care/CareRecordDetail.tsx#L59-L78) 可顯示版本、更正入口和歷史；[更正表單](https://github.com/2NTTY/child-ai-caregiver/blob/36434a235458646f8398229628e67f8ca5316bac/frontend/src/components/care/CareRecordForm.tsx#L77-L95) 有原因、共享內容預覽、確認及衝突核對。遇到衝突時列出原基準、最新版本和未保存的草稿；明確改用最新基準後仍須重新預覽與確認。這是同一筆已存記錄的詳情及更正表單，不是新建記錄、Agent 草稿、孩子檔案更正或獨立編輯器網址。

## 已直接檢視的參考

1. **更正-01｜ODK Central：從目前值追查已保存的改動**。[ODK 原圖](https://docs.getodk.org/_images/entity-conflict.png) 左側樹木記錄的目前樹圍為 10。右側紅框對照已發生的更新，下方活動顯示 102 → 97 → 10。Edit 是修改，Mark as Resolved 只解除警示。[詳情指南](https://docs.getodk.org/central-entities/#seeing-entity-detail) 和 [v2023.5 公告](https://forum.getodk.org/t/odk-central-v2023-5-entity-updates-via-submissions/44311) 說明這是事後提示，不是截住使用者的儲存操作。公告界定功能版本；原圖內沒有組建號。前置核對紀錄的官方 LFS 物件為 SHA-256 `eaa75382f03338e86c1b3d46e21e52574041d0efe713c22f4e4d73657c83fd39`，158,477 bytes。ODK Docs 採 CC BY 4.0。
2. **更正-02｜Wikimedia：保存前對照別人的新版與自己的草稿**。[Wikimedia 完整原圖](https://upload.wikimedia.org/wikipedia/commons/8/85/New_design_for_the_Two_Column_edit_conflict_interface%2C_status_October_2018.png) 用百科文章示例展示：左欄是別人已發布的版本，右欄是我的未發布文字；差異逐段選取，相同部分合在灰條，底部另有預覽與發布。[Commons 固定檔案說明](https://commons.wikimedia.org/w/index.php?title=File:New_design_for_the_Two_Column_edit_conflict_interface,_status_October_2018.png&oldid=1120316186) 的歷史與結構化資料對應 2020-09-08、1274 × 1058、714,161 bytes、SHA-1 `aa9d508c17d1a78fcdc57aa2621ddb9097722b39`。2018 年是較早圖版，不是本圖。原作署名 Johanna Strodt（WMDE），2020 版由 Max Klemm（WMDE）上傳，CC BY-SA 4.0。[官方指南修訂 8195680](https://www.mediawiki.org/w/index.php?title=Help:Paragraph-based_Edit_Conflict_Interface/en&oldid=8195680) 說明先選取、可預覽，再發布。只借鏡區分已保存和未保存的內容，不照搬逐段合併，也不以這張圖作為「更正原因」欄的依據。

兩款都只在點擊後開啟各自的原圖或說明。沒有把兩張原圖嵌入交付檔，也沒有使用真實家庭資料、登入外站、提交更正或改動正式資料。

## 私人讀本驗證

- HTML：30,899,102 bytes，SHA-256 `8b6f1e590d6c9cb403b286493131af30486e53ae22ab78cdd9748665ee6d995d`。前一個已交付版本 SHA-256 `5b429d40e70c60deded40c32d1c246f7c4b4171e0ca59586030c82c60cb76633`。
- 55 個主題、113 款設計（77 款離線、36 款外鏈）。前 54 題資料逐位元組保留，原 146 張內嵌圖片逐張解碼核對 SHA-256。第 55 題只增加 2 條原圖連結及 4 條版本／來源連結。
- 靜態差異、閱讀器腳本語法，以及 35 項執行交付 HTML 的離線 JS 閱讀器檢查通過；包括在第 54、55 頁來回、選擇、替換、取消、所選清單、鍵盤焦點狀態及外鏈屬性。不代表完整瀏覽器、鍵盤或行動裝置體驗已實測，也未把這兩種設計套用到育伴港。
