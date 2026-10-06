# 育伴港前端計劃

本文件只管前端當前工作、依賴、驗證及下一步；[STATUS](STATUS.md) 作短摘要，[HANDOFF](HANDOFF.md) 保存接線差異，[DESIGN_SYSTEM](DESIGN_SYSTEM.md) 保存已採納呈現。

<a id="active"></a>
## FE-W38 收束：來源復原與新整合修訂

更新：2026-10-06 UTC。目標是保住已完成的前端功能、恢復可檢查的來源及交接，再完成本包交付；只處理 `frontend/**`，不改正式 App、Server、Agent、資料庫、根依賴或根文件。

### 來源與現況

- 已取回 GitHub 暫存物件中的前端原始檔、部分歷史驗證及保存的設計文件。PR 基線為 `2a64fdd7`，相關正式契約歷史基線為 master `65f8cf37bceeb15b05f46326c49e0370349ae3a5`；兩者均不代表本次已推送或合併
- 原最後版 `app/(dashboard)/_layout.tsx`、`app/(dashboard)/history.tsx` 及本頁／STATUS／HANDOFF／GROWTH_HANDOFF 未完整取回，已依已取回程式另寫替代內容。新版不可冒稱原 v44 逐位元組復原
- 新 Dashboard layout 在共同祖先各掛一次資料 owner，History 路由只轉入既有畫面；沒有用孩子或情境 key 重掛整個 AppShell。資料 owner 仍按孩子／身份／Server／角色隔離並拒絕遲到回呼。Native 記錄入口已把 History 納入 active 判斷；這項只完成源碼／composition 檢查，未作原生 runtime 驗收
- 功能保留：家長對話 → Agent 整理 → 家長查看；手動填寫作補救。跨對話記錄核對、孩子概況／準備單、待辦／歷史、唯讀記憶與參考、持續關注鏈及標準 Web 成長報告均沿原同源接點
- 新修訂 full typecheck 與250 項 scripts 測試及 24 項 colocated 測試通過（合計 274 項）；Fresh Web export 已通過（37 條靜態路由、63 份輸出），本修訂限定 browser 驗收已通過；原生 runtime 未驗。GitHub draft PR #88 已確認更新至 `7119b4d3`，本次畫面證據正追加，尚未合併；Sites 發布狀態與 GitHub 交付分開核對

### 本次驗證結果

- [初次 aggregate](verification/reconstructed-revision-2026-10-06T0533Z/aggregate-tests-initial.log)：248 項中 237 通過、11 失敗，涉及注入重構後兩份測試的過時 mocks。原失敗保留；獲准只修測試契約後，針對測試 15 項通過
- [最後 aggregate](verification/reconstructed-revision-2026-10-06T0533Z/aggregate-tests-final.log)：250 通過、0 失敗，包含重建掛載、guard／source 導向及 native History active 的 source／composition 檢查。[Full typecheck](verification/reconstructed-revision-2026-10-06T0533Z/typecheck-final.log) 亦通過；完整命令及限制見 [checks](verification/reconstructed-revision-2026-10-06T0533Z/checks.json)。不是瀏覽器、正式 API、持久化或原生裝置驗收
- [Fresh Web export](verification/reconstructed-revision-2026-10-06T0533Z/export-manifest.json) 通過，包含 `/history`；使用者補交的首頁圖採原 bytes 納入，屬[新資產修訂](verification/reconstructed-revision-2026-10-06T0533Z/asset-revision.json)，不冒稱舊 Git 圖逐位元一致。公開預覽 v45 已於 2026-10-06 05:52 UTC 發布；[本修訂 browser 摘要](verification/reconstructed-revision-2026-10-06T0533Z/browser-qa/verification-summary.md)記錄四尺寸排版、關注結束／撤銷／恢復、孩子切換與減少動畫的限定驗收通過。本機預覽阻擋、一次 iframe pointer 方法失敗與補驗均保留；不宣稱逐幀無閃動、全站全狀態或原生 runtime 通過。

### 必要驗證與完成關口

1. 確認原始檔／基線／新重建檔的來源，固定新修訂 manifest；缺檔不由生成 bundle 或摘要猜回
2. 依實際可用依賴執行必要 typecheck、受影響測試及 Web export，保留失敗與未執行階段；驗證腳本存在不等於已執行
3. 受影響 UI 的實際瀏覽器檢查須另有此修訂證據：關注結束確認／取消／重複點擊／撤銷／歷史恢復、報告閱讀及導出不可用提示、記錄跨頁核對與孩子隔離。320／390／1024／1440、鍵盤焦點及轉場只報實際覆蓋範圍
4. Review 新重建的兩個 runtime 檔、四個交接文件及整合差異後，可先更新 draft PR 並明示尚待建置／畫面驗收；首頁圖採使用者補交的新資產，原 hero 圖保留於 Git 歷史；既有歷史檔案不刪，不上傳空白替代。必要建置及畫面檢查完成前不合併；遠端 commit、CI、合併或發布各自核實，不能從本地結果推定
5. 本包合併確認後，才從最新 master 開獨立清理 PR。清理在獨立副本準備與驗證，另開 PR；不混入本次復原交付

### 保留限制

正式 Agent 普通自動寫入／重要分類與確認事件、持久待確認總表、各領域正式 owner 與訂閱、成長關注鏈 archive／restore、長期報告生成與 PDF 均未因此接通。真 API／模型／家庭資料、真相機／咪高峰、APK／真機、完整 Server 歷史與跨瀏覽器／每幀無閃動均不能用合成或靜態證據替代。

<a id="evidence"></a>
### 可追溯的舊證據

以下檔案已取回，只支持檔案內記錄的版本和範圍，並非本次新整合驗收：

- [v40 合成畫面摘要](verification/next-release-2026-10-05T16-06Z-single-worker-recovery/browser-v40/verification-summary.md)
- [關注確認／撤銷／恢復的定向測試](verification/growth-confirm-restore-2026-10-05T18-59Z/checks.json)
- [時間線標記的定向檢查](verification/growth-timeline-2026-10-05T19-00Z/source-and-checks.json)
- [Owner／外殼生命週期檢查](verification/scope-shell-stability-2026-10-05T19-38Z/checks.json)：含原失敗及修訂後局部補驗；明示沒有新 browser／export 證據

未取回的最終 v44 QA／manifest 不能補寫成既有證據。來源 hash 不同的歷史結果保留其原限制；文件內的舊下一步及舊「當前」不構成新授權。

<a id="fe-w32-design-review"></a>
### 較早設計核查入口

FE-W32 的既有引用保留於此；較早發現見 [DESIGN_REVIEW](DESIGN_REVIEW.md)。當前呈現規則依 [DESIGN_SYSTEM](DESIGN_SYSTEM.md)，本次整合與驗收狀態依[當前包](#active)，歷史核查不等同此修訂通過。
