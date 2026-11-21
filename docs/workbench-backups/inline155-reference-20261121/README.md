# 選配工作台：切換孩子後未能載入：重讀新對象，或返回上一位

第 76 題新增兩張獨立重繪的完整頁示意，累計 76 題／155 款。
- A 依 [Freelens v2.0.0](https://github.com/freelensapp/freelens/blob/b9b53e16056578c5407312eba5823a089972f6d5/packages/core/src/renderer/components/cluster-manager/cluster-view.tsx#L87-L126)（相關程式 MIT），新工作區沒有連上時，中央顯示失敗與重連，原工作區畫面不再顯示。
- B 依 [GitHub Desktop 3.6.10](https://github.com/desktop/desktop/blob/ffeefe5de3861d3d33c85607eff1fbccf737a2f6/app/src/ui/app.tsx#L3369-L3393)（相關程式 MIT），主區顯示找不到所選項目，頂部選擇器仍可手動改選。

兩張都是非官方靜態示意，使用虛構資料。[育伴港現有畫面](https://github.com/2NTTY/child-ai-caregiver/blob/077d05722522fd3c393824ac308c063e8fa88cc6/frontend/src/motion/MotionScopeBoundary.tsx#L91-L120) 不顯示舊資料、不自動切回；只有仍可存取上一位孩子時，才提供返回。參考軟件的重連或本機檔案操作不是育伴港功能。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `f8721ac02688e368045013217befaeb5262e9901a73d25d1e49a476fbd5727a4`。
候選 HTML 564998 位元組，SHA-256 `38f98b62e296c1fb682f5911f4a800ac6ab64a1db896093923ddf21265e2ab39`。
原有 75 題、153 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 76 題並排顯示兩個來源；A 和 B 可分別放大，A 按 Escape、B 點暗處後均關閉並回復原按鈕焦點。

四個純文字檔：本說明、`candidate-155/build.py`、`candidate-155/manifest.json`、`check-candidate155.cjs`。
完整還原包另行私人保存：158 個 ZIP 條目、157 筆 SHA-256 清單、156 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
