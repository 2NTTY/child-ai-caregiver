# 選配工作台：待辦：回報完成，還是取消？

第 96 題新增兩張獨立重繪的完整頁示意，累計 96 題／195 款。
- A 依 [GNOME Evolution 3.58.2](https://github.com/GNOME/evolution/blob/9d5e61fc03417b48dcbf5cafa244cce64cd03d8f/src/calendar/gui/e-comp-editor-task.c#L906-L950)（相關程式 GPL-2.0-or-later），桌面待辦編輯器分開狀態選擇與保存。
- B 依 [Bugzilla 5.2](https://github.com/bugzilla/bugzilla/blob/276673ab67562bd27676d8c3a3770ec9897637b8/Bugzilla/Constants.pm#L203)（相關模板 MPL-2.0），完整事項頁可對照原有紀錄、留言和擬改的結果，再另行保存。FIXED 和 WONTFIX 不等同育伴港的狀態。

兩張都是非官方靜態示意。[育伴港的待辦表單](https://github.com/2NTTY/child-ai-caregiver/blob/1077b9901389b341ad9105a358480f8a12a7fd24/frontend/src/components/tasks/TaskForm.tsx#L88-L105) 讓家長先核對結果，再確認和保存。「回報已完成」備註可選；「取消事項」需要原因。這不是刪除，沒有改動實際待辦或送出提醒。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `267b653d2cc1de50f29ff29b3727687417b5497084443aa8b2d77b10c2024396`。
候選 HTML 680273 位元組，SHA-256 `39fbaa35119779eeab4da98fe6ee38b6e19da3e536b5be3de341cd2c3b557ea5`。
原有 95 題、193 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 96 題可直達、核對兩個固定來源；兩圖皆可放大，按 Escape／點暗處關閉後各自回復原圖按鈕焦點。只驗收工作台，沒有改動待辦或發送提醒。

四個純文字檔：本說明、`candidate-195/build.py`、`candidate-195/manifest.json`、`check-candidate195.cjs`。
完整還原包另行私人保存：198 個 ZIP 條目、197 筆 SHA-256 清單、196 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
