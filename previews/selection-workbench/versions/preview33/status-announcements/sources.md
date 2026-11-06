# SA01：來源與界線

這是可操作的合成 DOM 候選，不是 React Native 元件整合，也沒有讀屏、原生手勢、視覺或跨裝置驗收通過聲稱。

## 固定的產品來源

本輪觀察 master：2abe7aed60b192b253414f6464e3fd070cc377e7。原模組盤點固定於 e8918ddfde9ef5e978bb4d6d1b43d67193fa9a92；以下四檔在兩個 pin 的內容相同，但不代表整個 repository 沒有變更。

- [StatusAnnouncement：初次靜默、key gate、緊急程度](https://github.com/2NTTY/child-ai-caregiver/blob/2abe7aed60b192b253414f6464e3fd070cc377e7/frontend/src/components/StatusAnnouncement.tsx)
- [FormErrorSummary：錯誤公告與欄位焦點分開](https://github.com/2NTTY/child-ai-caregiver/blob/2abe7aed60b192b253414f6464e3fd070cc377e7/frontend/src/components/FormErrorSummary.tsx)
- [ReadStateNotice：讀取錯誤才 urgent](https://github.com/2NTTY/child-ai-caregiver/blob/2abe7aed60b192b253414f6464e3fd070cc377e7/frontend/src/components/ReadStateNotice.tsx)
- [OperationNotice：failed 才 urgent，visible 不控制公告](https://github.com/2NTTY/child-ai-caregiver/blob/2abe7aed60b192b253414f6464e3fd070cc377e7/frontend/src/components/OperationNotice.tsx)

source-derived.mjs 是手工轉寫公式，不是直接執行上面的原生原始碼。fixture owner、DOM 投射與兩種 UI 是本候選自寫部分，沒有保存狀態權威。所有示例只在此頁記憶體內，沒有 API、持久化、模型或語音。

## 設計參考

- [W3C status messages](https://www.w3.org/WAI/WCAG21/Understanding/status-messages.html)：參考不打斷焦點的原則；只讀指定段落，不據此宣稱符合標準。頁尾列 W3C permissive licence。
- [GOV.UK notification banner](https://design-system.service.gov.uk/components/notification-banner/)：參考把相關訊息放在工作旁；不採用成功事件自動 alert。
- [GOV.UK error summary](https://design-system.service.gov.uk/components/error-summary/)：參考錯誤到欄位的明確入口；不採用自動搶摘要焦點。GOV.UK 內容頁尾列 Open Government Licence v3.0，例外除外。

只參考概念，沒有複製第三方程式、樣式、字型或圖像。

## 尚未驗證

沒有瀏覽器視覺、真鍵盤／觸控、OS、VoiceOver、TalkBack、NVDA 或原生元件執行。普通 DOM span/polite 並不證明 React Native text role 的平台映射。新 key、相同訊息可更新 gate，但不強制改 DOM 文字，也不保證 AT 重播。B 紀錄不是播報佇列。loading 門檻是合成輸入，沒有跑原生 timer。
