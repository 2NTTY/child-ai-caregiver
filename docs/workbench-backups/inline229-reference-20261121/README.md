# 選配工作台（內嵌圖版）：小助手：移開後，切頁仍可再展開

第 113 題新增兩張獨立重繪的完整頁示意，累計 113 題／229 款。
- A 依 [AOSP Android 15 r1](https://github.com/aosp-mirror/platform_frameworks_base/blob/4e43ad12e1b211f15152e9c5b16b0fe88e6b93f3/libs/WindowManager/Shell/src/com/android/wm/shell/bubbles/BubbleStackView.java#L568-L593)（相關程式 Apache-2.0），一顆收起的泡泡停在整頁工作區的邊沿。
- B 依 [OBS Studio 32.0.4](https://github.com/obsproject/obs-studio/blob/dcdbd2e9048ae66237fdab32dbba72b745b1b9c5/frontend/forms/OBSBasic.ui#L944-L974)（相關程式 GPL-2.0-or-later），主工作區與可以移動或再開啟的工具窗分開。

兩張都是非官方靜態示意。[育伴港的小助手](https://github.com/2NTTY/child-ai-caregiver/blob/a2e176dbee2eac62b18eb3eed65060bcd3666705/frontend/src/components/companion/CharacterDock.tsx#L64-L145) 可在同一次開啟的支援頁面移動、收起及再展開；切頁不是開始對話，也不保證重新登入後保留位置。上游的跨應用泡泡及工具窗不是育伴港功能。沒有發送訊息、啟動模型或錄音錄影。程式授權並非官方圖像授權。

選用時請保留「內嵌圖版」、題號及 A/B、完整題名，以及這份固定備份的連結；本版與連結參考版的同號題目可能不同，不要把兩個目錄當成同一套號碼。

凍結基準 HTML SHA-256 `d78c1507dc07f0107b015117944b7499eb07d3935ba1be955a243bab8f79895a`。
候選 HTML 771761 位元組，SHA-256 `5446b0fb72062d2b6cd9dd1ba53acf2e589582587e554eac7bebf718858ffad4`。
原有 112 題、227 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 113 題可直達、核對兩個固定來源；兩圖皆可放大，按 Escape／點暗處關閉後各自回復原圖按鈕焦點。只驗收工作台，沒有操作小助手、裝置或錄影。

四個純文字檔：本說明、`candidate-229/build.py`、`candidate-229/manifest.json`、`check-candidate229.cjs`。
完整還原包另行私人保存：232 個 ZIP 條目、231 筆 SHA-256 清單、230 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
