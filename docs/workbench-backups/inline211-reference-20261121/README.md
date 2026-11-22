# 選配工作台：成長報告：日常檔案或指定期間？

第 104 題新增兩張獨立重繪的完整頁示意，累計 104 題／211 款。
- A 依 [Grafana v12.3.0](https://github.com/grafana/grafana/blob/20051fb1fc604fc54aae76356da1c14612af41d0/public/app/features/dashboard-scene/scene/DashboardSceneRenderer.tsx#L82-L111)（此處相關程式 AGPL-3.0-only），在完整現行儀表板旁顯示獨立快照設定，尚未發布。Grafana 快照和育伴港的指定期間不同。
- B 依 [LibreOffice Calc 26.2.0 build 3](https://github.com/LibreOffice/core/blob/afbbd0df0edb6d40b450b0337ac646b0913a760c/configure.ac#L14-L21)（相關程式 MPL-2.0，內含 Apache-2.0 來源告示），在完整試算表上比較連結和複製的選擇，尚未按下確定。

兩張都是非官方靜態示意。[育伴港建立成長報告](https://github.com/2NTTY/child-ai-caregiver/blob/7286b87b279486a997310ef511760bd482926085/frontend/src/components/preparations/DocumentCreateForm.tsx#L65-L77) 時，「日常檔案」保留所選開始日，延伸到當日香港日期並沿用同一份生效報告；「指定期間」明確填起訖，內容仍可按該期間內的資料修訂。兩款都不是即時更新承諾，不公開或匯入外部檔案。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `e689fc1e39fface51a753ec921b2faafa026898a80a6e60e64d8eed188c0a7e6`。
候選 HTML 722377 位元組，SHA-256 `aa1a9204ad4402b17a4d718ade26f310cf8d9e44fb8deb236be786bf8db7d01e`。
原有 103 題、209 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 104 題可直達、核對兩個固定來源；兩圖皆可放大，按 Escape／點暗處關閉後各自回復原圖按鈕焦點。只驗收工作台，未建立、發布或匯入報告。

四個純文字檔：本說明、`candidate-211/build.py`、`candidate-211/manifest.json`、`check-candidate211.cjs`。
完整還原包另行私人保存：214 個 ZIP 條目、213 筆 SHA-256 清單、212 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
