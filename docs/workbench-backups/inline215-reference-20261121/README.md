# 選配工作台：手動飲食記錄：約數照記，不知道就留空

第 106 題新增兩張獨立重繪的完整頁示意，累計 106 題／215 款。
- A 依 [Tandoor Recipes 2.7.6](https://github.com/TandoorRecipes/recipes/blob/89c07f26bb168221e41d409224976960cf344289/vue3/src/components/model_editors/RecipeEditor.vue#L87-L126)（相關程式 AGPLv3，另附 Commons Clause v1.0），在完整食譜步驟頁把數量和單位並排，可一併停用。這並非記錄約數的設定。
- B 依 [Wikibase Suite 8.3.0](https://github.com/wikimedia/mediawiki-extensions-Wikibase/blob/f4439bff9baebaa027a7b37be2bcaa8019b8f861/repo/resources/wikibase.wbui2025/components/editStatementGroup.vue#L1-L77)（所列延伸模組程式 GPL-2.0-or-later），滿版編輯器把數量和單位上下排列；上游的數值上下界不等於育伴港的「約數」。

兩張都是非官方靜態示意。[育伴港的手動飲食表單](https://github.com/2NTTY/child-ai-caregiver/blob/a2e176dbee2eac62b18eb3eed65060bcd3666705/frontend/src/components/care/CareRecordForm.tsx#L61-L89) 可保留「半」「碗」並標作「約數」。不知道時，數量及單位一起留空，預覽顯示「數量未提供」，不是零；原文及來源仍要填寫。沒有做換算、給飲食建議或保存任何資料。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `12c3374b346b80c1da52ebccea3844720b9808466f193347cc85e99f02c840e2`。
候選 HTML 732748 位元組，SHA-256 `0c81e6ea633b833c56e3d61c6b0f19284e307df9b2e1a4c526a2ad29b13683fd`。
原有 105 題、213 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 106 題可直達、核對兩個固定來源；兩圖皆可放大，按 Escape／點暗處關閉後各自回復原圖按鈕焦點。只驗收工作台，沒有換算、保存或發布。

四個純文字檔：本說明、`candidate-215/build.py`、`candidate-215/manifest.json`、`check-candidate215.cjs`。
完整還原包另行私人保存：218 個 ZIP 條目、217 筆 SHA-256 清單、216 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
