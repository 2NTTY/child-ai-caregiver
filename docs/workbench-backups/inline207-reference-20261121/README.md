# 選配工作台：照顧記錄：斷線時保留已載入內容

第 102 題新增兩張獨立重繪的完整頁示意，累計 102 題／207 款。
- A 依 [Thunderbird 159.0](https://github.com/thunderbird/thunderbird-desktop/blob/f88f34886f667703f55095f2ede6f31b15b42116/mail/base/content/about3Pane.xhtml#L153-L176)（相關程式 MPL-2.0），保留桌面列表，另在閱讀窗提示該項正文未能載入。
- B 依 [Wikipedia Android r/50603-r-2026-08-25](https://github.com/wikimedia/apps-android-wikipedia/blob/12d1dd2bffea3db7ead5a69b2025bcbf287fe64d/app/build.gradle#L38-L43)（相關程式 Apache-2.0），手機歷史頁保留列表，未有可讀副本的項目呈灰色。

兩張都是非官方靜態示意。[育伴港的照顧記錄](https://github.com/2NTTY/child-ai-caregiver/blob/7286b87b279486a997310ef511760bd482926085/frontend/src/components/care/CareSavedRecordsView.tsx#L31-L61) 斷線時仍可看同一孩子上次載入的項目，但不能當成最新或完整。未載入的詳情不等於沒有資料；搜尋和翻頁要等連線恢復。這不是下載，也不保證關頁後還可離線讀。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `8e060ad1c63836f9226415c2ee442d831428c245526b8b311331d78d7dd017b2`。
候選 HTML 711825 位元組，SHA-256 `655fbc32e644380c300ecd7c69b011f631d1153f582f98429338c21c76550a45`。
原有 101 題、205 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 102 題可直達、核對兩個固定來源；兩圖皆可放大，按 Escape／點暗處關閉後各自回復原圖按鈕焦點。只驗收工作台，未讀取或下載真正照顧記錄。

四個純文字檔：本說明、`candidate-207/build.py`、`candidate-207/manifest.json`、`check-candidate207.cjs`。
完整還原包另行私人保存：210 個 ZIP 條目、209 筆 SHA-256 清單、208 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
