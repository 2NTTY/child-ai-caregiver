# 選配工作台：手機底欄：點「核對」，上拉開「全部功能」

第 87 題新增兩張獨立重繪的完整頁示意，累計 87 題／177 款。
- A 依 [AOSP Launcher3 Android 16.0.0 r1](https://github.com/Goooler/Launcher3/blob/2f5b9b869d86620fdb899bc2df53d523dc9dc6ea/res/layout/launcher.xml#L31-L80)（相關程式 Apache-2.0），整個主頁可上滑進應用程式清單，平時點按個別圖示則打開程式。GitHub 來源是該固定 [AOSP 正式標籤](https://android.googlesource.com/platform/packages/apps/Launcher3/+/refs/tags/android-16.0.0_r1) 的同行提交鏡像。
- B 依 [Firefox Android 154.0](https://github.com/mozilla-firefox/firefox/blob/032a9fc1ac0cc3209f7c142744ba2e40847c8086/mobile/android/fenix/app/src/main/res/layout/fragment_browser.xml#L5-L38)（相關程式 MPL-2.0），受支援設定下從底部工具列上滑可切到全頁分頁總覽；點按網址仍開啟搜尋。

兩張都是非官方靜態示意，圖示及示例頁均為原創。[育伴港的手機底欄](https://github.com/2NTTY/child-ai-caregiver/blob/c59f0611c9319003691b294a24f7d4a3e9be5acc/frontend/src/components/navigation/RecordsNavButton.tsx#L13-L26) 點同一個「核對」入口去核對頁，合格上拉並放手才進「全部功能」；Web 向上鍵和原生無障礙展開亦可到達。系統／瀏覽器上滑只是不同視覺參考，不是相同手勢。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `9399efb18637dde5c79489d7727a5f452be6f1e2104c7a99ecbb2f7b91025e76`。
候選 HTML 631604 位元組，SHA-256 `63b3ef9a9f3a4738cf3de97c76cbecf89277f144fc803ec7acb565c4c19e3e0f`。
原有 86 題、175 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 87 題並排顯示兩個來源；A 和 B 可分別放大，A 按 Escape、B 點暗處後均關閉並回復原按鈕焦點。只測工作台，未操作手機手勢。

四個純文字檔：本說明、`candidate-177/build.py`、`candidate-177/manifest.json`、`check-candidate177.cjs`。
完整還原包另行私人保存：180 個 ZIP 條目、179 筆 SHA-256 清單、178 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
