# 選配工作台：直接在準備單勾選，未同步不等於已保存

第 84 題新增兩張獨立重繪的完整頁示意，累計 84 題／171 款。
- A 依 [Joplin Android 3.7.10](https://github.com/laurent22/joplin/blob/57b2f3082f8229e55382edb66d9c2458d7df18f5/packages/app-mobile/components/screens/Note/Note.tsx#L1912-L1941)（相關程式 AGPL-3.0-or-later），閱讀同一頁時，文字之間的清單可以逐項勾選。
- B 依 [TREK v5.1.3](https://github.com/liketrek/TREK/blob/6fbe10fe6383b18f9cbdb97fe55b8993de951dea/wiki/assets/PackingList.png)（相關程式 AGPL v3），用分類及進度集中顯示逐項勾選。

兩張都是非官方靜態示意，使用虛構外出準備內容。[育伴港現有準備單](https://github.com/2NTTY/child-ai-caregiver/blob/4a17d6206bb0b0518c2c9c7b0ddb886f36bc42a0/frontend/src/components/preparations/PreparationWorkspace.tsx#L265-L277) 區分未同步與背景保存。勾選不改正文或將另外的待辦標為完成，也不自動封存；成功保存的勾選仍可產生文件新版本。上游的百分比、數量或協作不是產品承諾。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `67e1487c338be02d53d12f3fbb9f5f25ed5eac69b23a55db6849f6829652bedf`。
候選 HTML 614086 位元組，SHA-256 `36a0bcc2ad16b7895ab8e49234a0f88fabaf24db88c34840c48097c807b2b3d2`。
原有 83 題、169 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 84 題並排顯示兩個來源；A 和 B 可分別放大，A 按 Escape、B 點暗處後均關閉並回復原按鈕焦點。未實際勾選或保存。

四個純文字檔：本說明、`candidate-171/build.py`、`candidate-171/manifest.json`、`check-candidate171.cjs`。
完整還原包另行私人保存：174 個 ZIP 條目、173 筆 SHA-256 清單、172 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
