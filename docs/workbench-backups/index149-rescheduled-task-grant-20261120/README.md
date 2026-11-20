# 選配工作台第 131 頁：借書改到週五，原本的到期聯絡授權還算嗎？

- **A｜先在同一待辦看改期。** [OpenProject 官方整頁原圖](https://raw.githubusercontent.com/opf/openproject/acbb059c8820da8236cee1f43dc0796d83836259/docs/user-guide/activity/openproject_user_guide_work_package_comment_highlighted.png)把任務資料和變動並列；原圖更動的是開始日期。育伴港方案從保存後的新到期日再進聯絡設定，該串接是設計提案。
- **B｜先在聯絡條件看這一版授權。** [Brevo 官方聯絡人詳情](https://help.brevo.com/hc/en-us/articles/360021862279-Overview-of-the-contact-details-page)把聯絡偏好、任務與活動分開。借用分區，擬議整頁把授權、既有渠道和發送結果區分。

合成例仍由本人負責。改期增加[任務版本](https://github.com/2NTTY/child-ai-caregiver/blob/6e91757e5f66fded6dc3f8bfe58602f2d26daf7a/server/task-policy.ts#L19-L29)；未到期的舊授權也不適用，不等於撤回或逾期。實際聯絡須[再核對新版授權、本人同意和渠道](https://github.com/2NTTY/child-ai-caregiver/blob/6e91757e5f66fded6dc3f8bfe58602f2d26daf7a/server/firestore-contact.ts#L139-L153)。保存不等於已發送、送達或已讀。工作台不動授權或真資料，不發送、重播或召回訊息；原圖只外連。

## 重建與檢查

- 前 130 頁不變。131 題、265 款，其中 169 款只外連，保留 165 張既有圖。
- #130 HTML SHA-256 `2b5348ab13a0bcacf5247f0a83d104f97586201f43912d13eb8534653cbcb81a`；`python append131.py baseline130.html spec131.json output131.html`。
- HTML 34,429,632 bytes，SHA-256 `9068de7995b7d94983201b839f6dfdcf7fcf062a4eb93a4b1aa18dd978470e00`；ZIP 22,788,460 bytes，SHA-256 `5c13f32102047ecb552d1511800dd78598d60811faaeb31381febeeb7a4779ef`。
- 離線檢查，未執行真實聯絡流程，未更新網站、主分支或四方案。
