# 照片前端交接

FE-W11：`codex/fe-w11-photos`；源碼及驗證 commit `ddcf651d820c12f6f46b2c1c01357afb6789fc1f`，由 B 帳號 `CherylNg-2526` 推送及建立 [draft PR #73](https://github.com/2NTTY/child-ai-caregiver/pull/73)，前置 FE-W10 `596c657fa7c67eb264c31bc65538c6822c360df2`（draft PR #70）。只改 `frontend/**`，主責 B，責任份額 100%、權重 5；AI 實作及驗證，實際 Committer 為 `2NTTY`，沒有聲稱 B 親自操作或 Verified 簽章。視覺由使用者確認，正式 Web／P3 接線由主聊天負責，不自行 merge。

## 契約及範圍

依使用者最新要求，先直接讀 GitHub master 的 [P2 UI 交接](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/docs/P2_UI_HANDOFF.md)，再局部讀 [照片 API](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/docs/API.md#p2-photos)、[photos 型別](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/src/shared/photos.ts) 及 [photo-api](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/src/client/photo-api.ts)。最初查核 `5098d64`，交付前直接重核 `ce87370`：型別／封裝 blob 未變，API 文件新增本人模型 key／可調上限，但照片章節逐字相同；交接總表已更新功能狀態。原 `PhotoPanel`／`P2_PHOTOS` 的相同實作證據沿用，不依賴主聊天本機是否已拉取。S12-W03 已合併，正式功能並非未實作；本頁只投影照片範圍，分享網頁／貼文另開前端包。

`/photos` 為 Expo Router 入口，桌面導覽、窄 Web 更多頁面、原生帳戶選單、照顧記錄及手機主頁快速記錄可到達。窄屏實際節點次序是選圖／原圖、草稿、清單，鍵盤順序與視覺一致；寬屏原圖／草稿和清單分欄。共用手機 MD3／48 觸控／SVG、Paper 控件、AppDialog、RHF／Zod；沒有新增依賴、色階、HTML 巨檔或根目錄規則。

## 接線入口

| 入口 | 用途及正式對照 |
|---|---|
| [PhotosView](src/components/photos/PhotosView.tsx)／[photo-view-model](src/photo-view-model.ts) | 純顯示資料與回調。`canCreate`、`canManage`、所有權／可見性及版本取自 Server；`isUploader` 只是對照 `ownerUserId` 與本人身份的顯示投影，不是新 API 欄位。私人編輯／提取／確認另須符合本人上傳者，不沿用 fixture 推算 |
| [PhotoRecordForm](src/components/photos/PhotoRecordForm.tsx)／[photo-form](src/components/photos/photo-form.ts) | 5,000 字原文、七種類、數值／單位成對、約數及時間原文；`photoConfirmationProjection` 對照正式 `CareValues`，不推算時間或轉換數值 |
| [PhotoFilePicker.web](src/components/photos/PhotoFilePicker.web.tsx) | 使用者明確選 JPEG／PNG，4 MiB／檔名 200 字；讀完整原檔、SHA-256、暫時 blob 預覽及惰性 base64。沒有壓縮、裁切、上傳或模型呼叫；真正格式／容量仍由 Server 驗證 |
| [PhotoFilePicker](src/components/photos/PhotoFilePicker.tsx) | 原生控件與 `selectOriginal(): Promise<PhotoOriginal \| null>` 薄 port；取消保留草稿、失敗提示、換範圍丟棄遲到結果。預覽沒有原生選圖 adapter，按鈕明確停用，不冒稱相簿／相機權限已接通 |
| [usePhotosPreview](src/preview/usePhotosPreview.ts)／[photoFixture](src/preview/photoFixture.ts) | 合成控制器及原有品牌示例；不能搬成真 API 或業務協定。照片候選為合成文字，不是對品牌圖的真實分析 |
| 正式 `PhotoApi` | `photos/photo/content` 授權讀取；`reserve/confirm/delete` 沿既有 online operation／原 opId；`upload/extract` 是直接請求，不能套用不存在的寫入收據 |

Web 本次原檔的 bytes／hash／mimeType 與原附件比對後才可繼續，來源私人保存後固定。正式 `content()` 已核對 MIME、大小及 hash；主聊天必須保留，不能用公開靜態 URL 替代私人附件。blob lease 由本頁控制器管理，未綁定附件的更換／取消即釋放，合成已保存附件的預覽保留至移除／退出；切換孩子、身份或卸載釋放全部。原檔／草稿不寫 localStorage、URL、工程檔或離線隊列；離開頁面、刷新及切孩子會清除本次輸入。

## 必須保留的狀態語義

1. 選圖是未保存輸入；`reserve` 只建立私人待上傳附件，`upload` 確認後才是原檔已保存。失敗、容量拒絕及斷線保留原檔／草稿，恢復連線不自動重傳。
2. 附件建立／共享／刪除結果未知：鎖定提交原文及原 opId。查核仍未確定不能新提交；尚無確認收據只明確重試原內容及原 opId。本頁的 `preview-photo-*` 只是合成參考，不是正式 opId。
3. 原檔上傳結果未知：重讀同一附件並核對相同 MIME／bytes／SHA-256；若已 ready 不重傳。只有查回仍 reserved，才可明確繼續同一附件及同一原檔。
4. AI 提取須另勾選模型外送同意。候選到達不覆蓋手動草稿，只有「採用候選並取代本頁草稿」會換入；候選／不確定事項仍需核對。未知提取查同一附件，這次提取不重送；已查核後可手動共享記錄。已確認共享的照片不能再次提取或確認。
5. 共享確認同時涵蓋原照片及孩子的家庭記錄，沿 `expectedVersion/confirmShared/CareValues`。私人聊天不跟隨共享，亦不代表已通知成員。草稿變更撤回預覽及共享勾選。
6. 版本衝突保留原檔／手動草稿，先重讀，再由使用者明確換基準並重新預覽。不可自動改版本提交。正式 adapter 須提供最新狀態／權限，已共享／不可管理時停止確認。
7. `confirmed` 收據但結果 `null` 是已刪除或不可讀，不能重送。附件建立結果不能識別時保留原檔並禁止重新建立，明確結束待查後逐項核對清單；只有明確清除本頁才能另選。共享／刪除不可讀結果清除可見詳情，再讀最新可授權清單。
8. 刪除先核對附件及連結記錄範圍，再另勾選最終確認；永久移除的確認與實體清理排程分開。關閉刪除對話框只是返回頁面，沒有取消已提交的原操作。權限／會話／孩子範圍失效清除資料、草稿、候選、原檔及遲到回調。

正式接線不能只傳 bool「成功」。須沿 `photo-api.ts` 既有 `reconcilePending/hasPendingOnline/resetOnline`、直接上傳／提取查核、confirmed-but-unavailable 及錯誤處理；版本／授權／清理排程由 Server 判斷。未知提交未解決時，正式 App 的路由控制須保留原查核能力或提示離開風險，不能返回頁面便另建提交。本人身份／API base／childId 均屬範圍 key，合成 key 沒有真 session 代表性。

## 已驗與未驗

typecheck、三項照片原文／成對數值單元、Web 25 個路由／Android Hermes 31 項資產 export、11 頁四寬度共 44 個重排、照片與手機必要合成互動通過，沒有 pageerror、console.error 或 API 請求。證據：[checks](verification/fe-w11/checks-layout-photos-mobile-density.json)／[build-checks](verification/fe-w11/build-checks.json)，實際 [1440 照片](verification/fe-w11/photos-1440.png)、[390 照片](verification/fe-w11/photos-390.png)、[320 原圖](verification/fe-w11/photos-320.png)／[草稿](verification/fe-w11/photos-320-manual-review.png)。最初檢查曾誤將 Paper 的唯讀輸入判成 DOM disabled，及漏開切孩子後重置的合成工具；修正測試判斷與操作後通過，沒有 force click。畫面截圖另等候 Paper 標籤浮起動畫完成。

Web 選檔／合成操作、Web 重排及 Android bundle 不代表真附件／Gemini／系統相簿已驗收；正式瀏覽器 API／模型／刪除、原生選圖／權限／Safe Area／TalkBack／APK／真機及使用者視覺確認仍待主聊天／使用者。既有正式 S12-W03 API／模型證據按未變部分復用，不用本頁合成結果替代，也不機械重跑。

瀏覽器能力按 [MDN File API](https://developer.mozilla.org/en-US/docs/Web/API/File_API/Using_files_from_web_applications) 及 [Web Crypto digest](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest) 核對（2026-09-30）：使用原生 file input、完整內容 hash 及明確釋放 object URL；Web Crypto 需要安全環境。是文件核對及本機預覽證據，並非真 API 上傳驗證。
