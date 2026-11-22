# 選配工作台：歷史對話：把原話帶回未送出的草稿

第 95 題新增兩張獨立重繪的完整頁示意，累計 95 題／193 款。
- A 依 [Zulip 12.3](https://github.com/zulip/zulip/blob/b31982251ff82d0b02e59f63ad21f19204e37aea/templates/zerver/app/index.html#L243-L275)（相關程式 Apache-2.0），把引文放進可編輯的輸入框。是否送出仍由使用者決定。
- B 依 [Element Web v1.12.12](https://github.com/element-hq/element-web/blob/074a69aa1ed50e01408f560feee43852b930f71f/apps/web/src/components/structures/RoomView.tsx#L1222-L1231)（回覆預覽檔案採其 AGPL-3.0-only 選項），回到原房間後，把可移除的回覆目標放在輸入框上方。

兩張都是非官方靜態示意。[育伴港的「帶回助手」](https://github.com/2NTTY/child-ai-caregiver/blob/1077b9901389b341ad9105a358480f8a12a7fd24/frontend/src/production/ProductionProvider.tsx#L168-L173) 只在輸入框未有文字時填入可編輯的純文字草稿。已有文字就原樣保留，不覆蓋或附加引文。不會自動送出，也不新增獨立回覆卡。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `a0acc7ed5196b1ffc0827dd2eccd852d81fb43b12be792e78e3078670e69e81f`。
候選 HTML 674740 位元組，SHA-256 `267b653d2cc1de50f29ff29b3727687417b5497084443aa8b2d77b10c2024396`。
原有 94 題、191 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 95 題可直達、核對兩個固定來源；重驗修正後的純文字引文及另一款預覽。兩圖皆可放大，按 Escape／點暗處關閉後各自回復原圖按鈕焦點。只驗收工作台，沒有讀取真正對話、起草或送出訊息。

四個純文字檔：本說明、`candidate-193/build.py`、`candidate-193/manifest.json`、`check-candidate193.cjs`。
完整還原包另行私人保存：196 個 ZIP 條目、195 筆 SHA-256 清單、194 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
