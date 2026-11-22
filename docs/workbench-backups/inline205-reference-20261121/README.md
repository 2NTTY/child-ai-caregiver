# 選配工作台：官方親子教材：看影片，還是讀官方文字稿？

第 101 題新增兩張獨立重繪的完整頁示意，累計 101 題／205 款。
- A 依 [PeerTube v8.1.1](https://github.com/Chocobozzz/PeerTube/blob/0d4d8bb9841a83477dae800df2aba4c5fc222b87/client/src/app/%2Bvideo-watch/video-watch.component.html#L13-L59)（相關程式 AGPL-3.0-or-later），在完整觀看頁上把文字稿放到影片旁邊。
- B 依 [Open edX Sumac.1](https://github.com/edx/edx-platform/blob/bc17b35afb0ff65cd1783fa83b4e4dbb10624378/lms/templates/courseware/courseware.html#L212-L285)（相關程式 AGPLv3），在完整課節裡分開播放及影片下方的文字稿檔案入口。

兩張都是非官方靜態示意。[育伴港的教材「相關影音」](https://github.com/2NTTY/child-ai-caregiver/blob/7286b87b279486a997310ef511760bd482926085/frontend/src/components/memory/MemoryReferenceView.tsx#L167-L225) 只在同一項影音有已核實的官方文字稿連結時另顯示「文字稿」。兩個入口都連到發布方頁面，不在育伴港播放、同步、下載或生成文字稿。示意沒有使用官方片段或提供健康建議。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `fc5fd480cc20c2d7b1c045050171b36a19c9f618736e6454f920c2e043c8d9fc`。
候選 HTML 705994 位元組，SHA-256 `8e060ad1c63836f9226415c2ee442d831428c245526b8b311331d78d7dd017b2`。
原有 100 題、203 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 101 題可直達、核對兩個固定來源；兩圖皆可放大，按 Escape／點暗處關閉後各自回復原圖按鈕焦點。修正後的 Open edX 示意已複驗。只驗收工作台，未播放或下載教材。

四個純文字檔：本說明、`candidate-205/build.py`、`candidate-205/manifest.json`、`check-candidate205.cjs`。
完整還原包另行私人保存：208 個 ZIP 條目、207 筆 SHA-256 清單、206 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
