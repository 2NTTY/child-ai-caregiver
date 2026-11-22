# 選配工作台：關注與準備：留在原頁查看待辦

第 93 題新增兩張獨立重繪的完整頁示意，累計 93 題／189 款。
- A 依 [Thunderbird 159.0](https://github.com/thunderbird/thunderbird-desktop/blob/f88f34886f667703f55095f2ede6f31b15b42116/mail/base/content/messenger.xhtml#L557-L598)（相關程式 MPL-2.0），原頁與右邊停靠的資訊欄並排。
- B 依 [GNOME Shell 51.0](https://github.com/GNOME/gnome-shell/blob/2177bdf9624b2d285de7c1d34274073d3769d6b8/js/ui/dateMenu.js#L887-L952)（相關程式 GPL-2.0-or-later），較窄畫面用臨時浮層，背後仍看得到原頁。GNOME 原來由頂部時鐘展開，這裡只參考浮層與原頁的關係。

兩張都是非官方靜態示意。[育伴港的資訊側欄](https://github.com/2NTTY/child-ai-caregiver/blob/657d5b19f97f3c28c6fd242968859d4f4c848487/frontend/src/components/RightRailContent.tsx#L9-L22) 顯示當前所選孩子的待辦與提醒。「查看事項」進入一般待辦清單，「概況」另有入口。開關側欄不會完成待辦，也不等於查看通知有否送達。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `835cf793ed6025edcbe05771e1936f2a777ccbdf171b6b15ce15997467529c9a`。
候選 HTML 664636 位元組，SHA-256 `a175abb83f9cb8178dda5a11bd88b6a7dea458fa23d31bdb8aef3db3b770050b`。
原有 92 題、187 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 93 題可直達、核對兩個固定來源，兩圖皆可放大，按 Escape／點暗處關閉後回復原圖按鈕焦點。這只驗收工作台，未操作產品待辦或提醒。

四個純文字檔：本說明、`candidate-189/build.py`、`candidate-189/manifest.json`、`check-candidate189.cjs`。
完整還原包另行私人保存：192 個 ZIP 條目、191 筆 SHA-256 清單、190 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
