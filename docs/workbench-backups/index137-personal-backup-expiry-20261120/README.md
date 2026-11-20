# 選配工作台第 119 頁：本人備份過期後，原資料和已下載副本還在嗎？

- **A｜匯出歷史。** [MyHealthPEI 官方手冊第 8 頁](https://www.princeedwardisland.ca/sites/default/files/eb73/MyHealthPEI%20Communications%20Centre%20Navigation.pdf#page=8)的匯出工作區同時有可下載及已過期的紀錄。只參考清單，不搬用原站期限或刪除按鈕。
- **B｜單份備份詳情構想。** [GitHub 官方局部原圖](https://github.blog/wp-content/uploads/2018/12/50226471-44162300-0371-11e9-8386-85f43f976508.png)只示範單份暫存包及下載期限。構想另分裝置副本和原資料；不把局部圖當作已部署的三欄詳情頁。

育伴港以[伺服器保存的到期時間](https://github.com/2NTTY/child-ai-caregiver/blob/27b400aca0b0af25eaa26e867adbc460e03cf0f4/server/firestore-handover-jobs.ts#L244-L268)為準，從建立匯出起算 24 小時。到期後不能再取同一暫存包，不用等清理，也不代表已刪。原資料不因此移除，已完成的下載也不會被撤回；本站無法查到裝置是否仍有檔，還原資格另核。兩案只讀，不下載、不清理、不還原；原作者、版本及權利見 `spec119.json`，新增原圖只外連。

## 重建與檢查

- 前 118 頁不變。共 119 題、241 款，其中 145 款只外連；保留 165 張既有離線圖。
- 用已驗證 #118 HTML（SHA-256 `aa206ad8d3db5cd3199c6fec0e035e00f255adc8f06cd87aeb5a606dc6b55bee`），執行 `python append119.py baseline118.html spec119.json output119.html`。
- HTML 34,359,825 bytes，SHA-256 `9b7a99e4c2e883832f2246f85edf7d87cbc78a69ae7b7b34747a020fe05f4171`；單檔 ZIP 22,766,655 bytes，SHA-256 `50d114f78c87801387a11e23c32ed7ab8c7c7f3c2b076f70db310ef5dbeac594`。
- 獨立分支只放可重建文字，沒有更新網站、主分支或四方案。
