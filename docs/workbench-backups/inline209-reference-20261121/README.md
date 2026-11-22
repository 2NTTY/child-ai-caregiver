# 選配工作台：家庭附件庫：先看清家庭與孩子，再選檔

第 103 題新增兩張獨立重繪的完整頁示意，累計 103 題／209 款。
- A 依 [Nextcloud Files v32.0.0](https://github.com/nextcloud/server/blob/5ee29decb00508122f008abacea26fb3e122b13c/apps/files/src/views/FilesList.vue#L7-L37)（相關程式 AGPL-3.0-or-later），在現有附件列表上方同時顯示目的地和加入檔案入口。
- B 依 [WordPress 6.9.1](https://github.com/WordPress/WordPress/blob/034dcde94c906b65266b79306694fced11d9c3da/wp-admin/media-new.php#L65-L90)（相關程式 GPL-2.0-or-later），在獨立媒體頁集中顯示選檔入口；示意尚未選檔。

兩張都是非官方靜態示意。[育伴港的家庭附件庫](https://github.com/2NTTY/child-ai-caregiver/blob/7286b87b279486a997310ef511760bd482926085/frontend/src/production/FamilyLibraryUpload.tsx#L20-L51) 只在已有合資格家庭與孩子範圍顯示目的地。選檔即開始保存，沒有另一次預覽或批准；只在伺服器確認就緒後顯示已保存。不會傳到聊天、提取文字或建立照顧記錄。示意沒有選檔或上載。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `655fbc32e644380c300ecd7c69b011f631d1153f582f98429338c21c76550a45`。
候選 HTML 716631 位元組，SHA-256 `e689fc1e39fface51a753ec921b2faafa026898a80a6e60e64d8eed188c0a7e6`。
原有 102 題、207 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 103 題可直達、核對兩個固定來源；兩圖皆可放大，按 Escape／點暗處關閉後各自回復原圖按鈕焦點。只驗收工作台，沒有選檔、上載或更改分享範圍。

四個純文字檔：本說明、`candidate-209/build.py`、`candidate-209/manifest.json`、`check-candidate209.cjs`。
完整還原包另行私人保存：212 個 ZIP 條目、211 筆 SHA-256 清單、210 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
