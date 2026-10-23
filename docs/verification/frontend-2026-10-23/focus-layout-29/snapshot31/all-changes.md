# 本輪完整改動與31補充

29的頁型／focus／讀取範圍／Tabs導航及30的metadata／Contact契約詳見[34產品分類說明](../snapshot30/all-changes.md)。以下列31最終37產品並集，不重複計入已存在於29／30的檔案；test25與設計doc1另見完整scope。

31新增重點：同scope讀取期間保護Summary控制焦點而繼續鎖操作；overview穩定已確認內容避免tab幾何跳動；記憶private短標籤改「本人」。原permission／scope／opId／first-error／pending安全不放寬。

|產品路徑|版本差異|
|---|---|
|`frontend/src/child-overview-view-model.ts`|31有改；需新定向覆驗|
|`frontend/src/components/DateTimeFields.tsx`|31有改；需新定向覆驗|
|`frontend/src/components/agent/AgentRunView.tsx`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/components/agent/proposal-presentation.ts`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/components/care/CareRecordDetail.tsx`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/components/care/CareReviewHistoryView.tsx`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/components/care/CareSavedRecordsView.tsx`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/components/contact/contact-form.ts`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/components/growth/GrowthConcernTimeline.tsx`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/components/memory/MemoryReferenceView.tsx`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/components/model-settings/ModelSettingsView.tsx`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/components/navigation/app-navigation.ts`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/components/preparations/PreparationWorkspace.tsx`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/components/shared-inputs/SourcesView.tsx`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/components/summary/SummaryView.tsx`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/components/tasks/TaskContent.tsx`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/components/tasks/TaskHistoryView.tsx`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/components/tasks/TaskListRow.tsx`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/components/ui.tsx`|31有改；需新定向覆驗|
|`frontend/src/components/useQuietReadFocus.ts`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/memory-view-model.ts`|31有改；需新定向覆驗|
|`frontend/src/production/AgentAuthorization.tsx`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/production/AgentAuthorizationOwner.ts`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/production/CareProfileDomains.tsx`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/production/CareReadCoordinator.ts`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/production/SettingsDomains.tsx`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/production/TaskKnowledgeSummaryContent.tsx`|31有改；需新定向覆驗|
|`frontend/src/production/task-knowledge-memory.ts`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/production/task-knowledge-read-window.ts`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/production/task-knowledge-summary.ts`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/production/task-knowledge-tasks.ts`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/production/usePhotoInputSources.ts`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/production/useProductionModelSettings.ts`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/production/useProductionNotificationPreferences.ts`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/screens/careScreen.tsx`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/screens/chatScreen.tsx`|29／30來源保留；browser只按原版本結果引用，非31全重跑|
|`frontend/src/shared-input-view-model.ts`|29／30來源保留；browser只按原版本結果引用，非31全重跑|

共用ui.tsx／DateTimeFields已變；頁檔未改不能單獨證明行為無影響。31新增control smoke及Summary自然focus結果另錄。DESIGN文檔附加是build以外獨立更新，產品hash不重寫。
