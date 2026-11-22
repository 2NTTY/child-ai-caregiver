# 選配工作台：長期記憶：停用過時資料，保留原文和版本

第 100 題新增兩張獨立重繪的完整頁示意，累計 100 題／203 款。
- A 依 [Firefox 154.0](https://github.com/mozilla-firefox/firefox/blob/032a9fc1ac0cc3209f7c142744ba2e40847c8086/toolkit/mozapps/extensions/content/aboutaddons.html#L226-L244)（相關程式 MPL-2.0），分組顯示啟用和停用項目，停用的項目仍見於列表。
- B 依 [Anki 25.09.2](https://github.com/ankitects/anki/blob/3890e12c9e48c028c3f12aa58cb64bd9f8895e30/.version#L1)（相關程式 AGPL-3.0-or-later），從左側篩選暫停項目，保留原卡供查閱。

兩張都是非官方靜態示意。[育伴港的記憶管理](https://github.com/2NTTY/child-ai-caregiver/blob/7286b87b279486a997310ef511760bd482926085/frontend/src/production/TaskKnowledgeMemoryManagement.tsx#L143-L161) 將「標記停用」和「永久刪除」分開。停用需原因和確認；原內容及版本仍保留，沒有變更分享權限。這些示意沒有停用或刪除真實資料。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `2ed641fcf89d366ad93fcbbf436aa9bdeaacd3fd6ae8e708e5e36e418cf08ac8`。
候選 HTML 701145 位元組，SHA-256 `fc5fd480cc20c2d7b1c045050171b36a19c9f618736e6454f920c2e043c8d9fc`。
原有 99 題、201 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 100 題可直達、核對兩個固定來源；兩圖皆可放大，按 Escape／點暗處關閉後各自回復原圖按鈕焦點。只驗收工作台，未停用或刪除真實資料。

四個純文字檔：本說明、`candidate-203/build.py`、`candidate-203/manifest.json`、`check-candidate203.cjs`。
完整還原包另行私人保存：206 個 ZIP 條目、205 筆 SHA-256 清單、204 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
