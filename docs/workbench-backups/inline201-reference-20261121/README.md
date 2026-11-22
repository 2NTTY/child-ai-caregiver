# 選配工作台：設定分類：在左欄或頂部切換

第 99 題新增兩張獨立重繪的完整頁示意，累計 99 題／201 款。
- A 依 [GNOME Settings 50.0](https://github.com/GNOME/gnome-control-center/blob/1cc97e799d7aa0591e2fc41cb606e74040eaf9cd/shell/cc-window.blp#L4-L65) 的完整設定視窗，寬版把分類放在左邊。框架程式 GPL-2.0-or-later；畫面內「系統」區另採 [GPL-3.0-or-later](https://github.com/GNOME/gnome-control-center/blob/1cc97e799d7aa0591e2fc41cb606e74040eaf9cd/panels/system/cc-system-panel.c#L1-L19)。
- B 依 [Syncthing v2.0.0](https://github.com/syncthing/syncthing/blob/5d8033343fd31963286395b009fa7ff0b18ee461/gui/default/syncthing/settings/settingsModalView.html#L1-L40)（相關程式 MPL-2.0），分類橫排在目前內容上方。它用對話框，不等同育伴港的頁內橫滑。

兩張都是非官方靜態示意。[育伴港的設定頁](https://github.com/2NTTY/child-ai-caregiver/blob/12132af38b7199282da86a3a29a088ecac329d35/frontend/src/screens/settingsScreen.tsx#L45-L65) 可從「通知」轉看「孩子」分類，寬版左欄、窄版用可橫滑的分類列。只轉換顯示內容，沒有更改實際設定、所選孩子或權限；範圍文字也不是權限證明。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `1ff7a63d4beb897416e86d8fd525c33e463bef800b2a155b639ec207c08d1f46`。
候選 HTML 695849 位元組，SHA-256 `2ed641fcf89d366ad93fcbbf436aa9bdeaacd3fd6ae8e708e5e36e418cf08ac8`。
原有 98 題、199 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 99 題可直達、核對兩個固定來源；兩圖皆可放大，按 Escape／點暗處關閉後各自回復原圖按鈕焦點。只驗收工作台，未改動設定、孩子或權限。

四個純文字檔：本說明、`candidate-201/build.py`、`candidate-201/manifest.json`、`check-candidate201.cjs`。
完整還原包另行私人保存：204 個 ZIP 條目、203 筆 SHA-256 清單、202 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
