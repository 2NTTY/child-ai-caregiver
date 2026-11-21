# 選配工作台：多人待辦批次：已保存的保留，只接續未執行

第 75 題新增兩張獨立重繪的完整頁示意，累計 75 題／153 款。
- A 依 [Argo Workflows v3.7.3](https://github.com/argoproj/argo-workflows/blob/bded09fe4abd37cb98d7fc81b4c14a6f5034e9ab/ui/src/workflows/components/workflow-details/workflow-details.tsx#L487-L529)（相關程式 Apache-2.0），流程圖保留已完成節點，選中暫停節點後可在右側接續。
- B 依 [GitLab v18.5.0](https://github.com/gitlabhq/gitlabhq/blob/a2f69d15ebab6fda20fef41f44707ee920510ae8/app/assets/javascripts/ci/pipeline_details/jobs/jobs_app.vue#L120-L145)（相關程式 MIT Expat），工作表並列已完成與等待手動執行項目，三角按鈕只啟動該列。

兩張都是非官方靜態示意，不觸發任何操作。[育伴港原對話旁的批次](https://github.com/2NTTY/child-ai-caregiver/blob/49e5b97bff4fe1e3b432a796591d11182726bbe8/frontend/src/production/MixedChatConversation.tsx#L103-L145) 會保留已保存結果，只接續未執行項目；已結束的部分失敗沒有「繼續」。上游單一節點／工作列的動作並不等同產品。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `8a3be885baa9affd0cf4a590fbfe0330b31a83a661b441a146ac4cd3af280b8c`。
候選 HTML 558975 位元組，SHA-256 `f8721ac02688e368045013217befaeb5262e9901a73d25d1e49a476fbd5727a4`。
原有 74 題、151 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 75 題並排顯示兩個來源；A 和 B 可分別放大，A 按 Escape、B 點暗處後均關閉並回復原按鈕焦點。

四個純文字檔：本說明、`candidate-153/build.py`、`candidate-153/manifest.json`、`check-candidate153.cjs`。
完整還原包另行私人保存：156 個 ZIP 條目、155 筆 SHA-256 清單、154 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
