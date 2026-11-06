# 快捷入口與記錄 · QK01

這是一個合成候選的兩種介面：A「拇指托盤」直接選動作；B「指令目錄」先搜尋/選擇，再確認。兩者共用同一份本頁合成草稿。入口只回報目的地意圖，不會導航、傳送、上傳、保存或修改照護記錄。

只有合成文字、固定檔名/大小與目的地。沒有真照片、選檔器、相機、麥克風、帳戶設定、API 或模型。合成處理中/結果未定保留原 ID，不在這裡清除、重試或替換。重新載入本頁不是恢復正式資料的功能。

## 項目來源

固定來源是 2NTTY/child-ai-caregiver 的 2abe7aed60b192b253414f6464e3fd070cc377e7，不是本頁對即時 master 的宣稱。

- [HomeQuickActions](https://github.com/2NTTY/child-ai-caregiver/blob/2abe7aed60b192b253414f6464e3fd070cc377e7/frontend/src/components/HomeQuickActions.tsx)：入口與拒絕後復位。
- [MobileQuickInputDock](https://github.com/2NTTY/child-ai-caregiver/blob/2abe7aed60b192b253414f6464e3fd070cc377e7/frontend/src/components/agent/MobileQuickInputDock.tsx)：只開啟輸入，與送出分開。
- [assistant-draft](https://github.com/2NTTY/child-ai-caregiver/blob/2abe7aed60b192b253414f6464e3fd070cc377e7/frontend/src/assistant-draft.ts)、[home-agent-entry](https://github.com/2NTTY/child-ai-caregiver/blob/2abe7aed60b192b253414f6464e3fd070cc377e7/frontend/src/home-agent-entry.ts)、[quick-input-gesture](https://github.com/2NTTY/child-ai-caregiver/blob/2abe7aed60b192b253414f6464e3fd070cc377e7/frontend/src/components/navigation/quick-input-gesture.ts)：同項目 helper，以 type-only 轉換保留；不是正式文字/上傳 owner。
- [ProductionProvider](https://github.com/2NTTY/child-ai-caregiver/blob/2abe7aed60b192b253414f6464e3fd070cc377e7/frontend/src/production/ProductionProvider.tsx)、[PreviewNavigationGuard](https://github.com/2NTTY/child-ai-caregiver/blob/2abe7aed60b192b253414f6464e3fd070cc377e7/frontend/src/preview/PreviewNavigationGuard.tsx)：只參考接納與保留契約，沒有接入本頁。

## 設計參考

- [cmdk README](https://github.com/pacocoursey/cmdk)：參考受控搜尋/分組/空結果；未複製程式、未使用套件。其 [MIT License](https://github.com/dip/cmdk/blob/main/LICENSE.md) 已查看。
- [W3C Pointer Gestures](https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures.html) 與 [Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)：採單點按鈕，不依賴拖曳或長按。沒有複製圖片或外部資產。

本頁是新 DOM/CSS adapter，不是原 React/Native renderer。只有有界程式與合成 DOM 檢查；真瀏覽器畫面、鍵盤、pointer/gesture、讀屏、原生/裝置權限及正式 provider 全未驗。沒有完整無障礙或產品驗收通過聲稱。
