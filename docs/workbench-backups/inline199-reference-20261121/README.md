# 選配工作台：照顧交接：只用已共享資料整理準備單

第 98 題新增兩張獨立重繪的完整頁示意，累計 98 題／199 款。
- A 依 [CiviCRM 6.7.0](https://github.com/civicrm/civicrm-core/blob/d11cbdf3b09d5824e27c9a2f19b2a144cc70e835/templates/CRM/Report/Form.tpl#L23-L50)（相關程式為 AGPLv3，另有 CiviCRM 列明的例外），在完整報表頁分開條件及建立動作。
- B 依 [ERPNext v15.90.0](https://github.com/frappe/erpnext/blob/a66ce02520f421f13c350fc5fb8252c5f450e08e/erpnext/__init__.py#L7)（相關程式 GPLv3），在完整新文件頁上另開選擇來源的視窗；示意沒有帶入資料或保存。

兩張都是非官方靜態示意。[育伴港的準備單表單](https://github.com/2NTTY/child-ai-caregiver/blob/1077b9901389b341ad9105a358480f8a12a7fd24/frontend/src/components/preparations/DocumentCreateForm.tsx#L41-L77) 讓使用者填名稱、用途和來源期間後，確認家庭共享範圍才整理。只用獲授權的孩子資料，不讀私人對話，不逐筆選資料，也沒有建立前結果預覽。沒有建立或分享真實文件。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `23c6606cbad6bf3a65274cbe17be46466d0f2c135eea907e549f4b2df7ee8753`。
候選 HTML 690800 位元組，SHA-256 `1ff7a63d4beb897416e86d8fd525c33e463bef800b2a155b639ec207c08d1f46`。
原有 97 題、197 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 98 題可直達、核對兩個固定來源；兩圖皆可放大，按 Escape／點暗處關閉後各自回復原圖按鈕焦點。只驗收工作台，沒有整理或分享文件。

四個純文字檔：本說明、`candidate-199/build.py`、`candidate-199/manifest.json`、`check-candidate199.cjs`。
完整還原包另行私人保存：202 個 ZIP 條目、201 筆 SHA-256 清單、200 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
