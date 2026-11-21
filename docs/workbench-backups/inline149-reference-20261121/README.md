# 選配工作台：更換本人頭像，保存前先看裁切

第 73 題加入兩張獨立重繪的非官方示意，總數 73 題／149 款。
A 依 [GitLab v18.5.0](https://github.com/gitlabhq/gitlabhq/blob/a2f69d15ebab6fda20fef41f44707ee920510ae8/app/views/user_settings/profiles/show.html.haml#L179-L207)（相關程式 MIT Expat），在個人資料頁疊加固定方框、拖動和縮放。
B 依 [BuddyPress 14.0.0](https://github.com/buddypress/buddypress/blob/8b15774c315c5bf7ae74f3b00e082e17088f2a5d/src/bp-core/js/avatar.js#L700-L739)（程式 GPL-2.0-or-later），在獨立裁切頁的右側呈現同一裁切範圍的預覽。
兩圖使用自製幾何帆船和虛構資料，尚未套用新頭像，不推論原件是否已上傳；程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `668b35e44f30e493d123af0605915d39a09c973eb945b09a278461a6efa86f3b`。
本候選 HTML 546258 位元組，SHA-256 `b89fe0738bfbd4a7eb96a4834ba0d9c4ef89a7ae9b10ec1e38aa290d23e7f301`。
原有 72 題、147 張圖片位元組完整保留。獨立來源與全尺寸圖片複核，離線比較、焦點回復，Chrome 同頁查看、A/B 放大、Escape 和暗處關閉均通過。
四個純文字檔：本說明、`candidate-149/build.py`、`candidate-149/manifest.json`、`check-candidate149.cjs`。
完整還原包有 152 個 ZIP 條目、151 筆 SHA 清單及 150 個工作台檔案，另作私人復原。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
