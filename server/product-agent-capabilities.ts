/** Server-authored capability descriptions; user text never selects this catalog. */
export const PRODUCT_AGENT_TOOL_CATALOG = {
  coreToolNames: ["read_context", "search_knowledge", "read_knowledge_context", "present_answer", "read_care_records", "read_private_instructions", "read_work", "save_work", "search_history", "read_history", "request_confirmation"],
  loader: {
    name: "load_capabilities",
    description: "依目前對話、前文指向及工具結果，載入所需的產品能力。可一次選多個能力；載入只提供工具及指引，不執行業務操作或取得授權。需要讀上下文／知識時可在同一輪分別調用讀取與載入；載入成功後才使用新增工具。只載入相關能力，不必按固定順序或把每種能力都載入。",
    parameterDescription: "本次需要的能力 ID；只從 Server 提供的目錄選取，可同時載入多項。",
  },
  groups: [
    { id: "care_records", description: "按家長交代保存或更正普通照護記錄；由 Server 檢查本人預授權及原資源。",
      toolNames: ["save_ordinary_record", "revise_ordinary_record"], promptModuleIds: ["module.capture-confirmation"] },
    { id: "memory", description: "保存／更正普通私人交代、提出重要事實候選或整理已讀對話；推測不升格為事實。",
      toolNames: ["save_private_instruction", "revise_private_instruction", "propose_fact", "stage_private_summary", "read_memory_facts", "propose_fact_revision", "propose_fact_deactivation"], promptModuleIds: ["module.memory-maintenance"] },
    { id: "tasks", description: "安排、改期、取消或完成待辦／提醒；低風險指令按現有授權直接做，其餘提出具體候選。",
      toolNames: ["create_ordinary_reminder", "change_ordinary_reminder", "propose_task", "propose_task_change"], promptModuleIds: ["module.task-intents"] },
    { id: "documents", description: "分段閱讀、按穩定 ID 局部修改同一份準備單／報告，核對正文候選，查歷史及歸檔；亦可讀期間照護摘要。",
      toolNames: ["read_family_documents", "read_family_document_content", "list_family_document_versions", "generate_family_document", "change_family_document", "propose_family_document_change", "read_care_summary"], promptModuleIds: ["module.summary-report"] },
    { id: "concerns", description: "查看持續關注及經過，提出建立、追加觀察、結束、恢復或站內跟進候選。",
      toolNames: ["read_concerns", "propose_concern", "propose_concern_change"], promptModuleIds: [] },
    { id: "private_sources", description: "查看本人授權的私人材料與引用，提出來源設定、內容／用途修改或停用候選；不擴大公共或共享範圍。",
      toolNames: ["list_private_sources", "read_private_source", "propose_private_source", "propose_private_source_change"], promptModuleIds: [] },
    { id: "contact", description: "核對已確認事項的聯絡資格，僅在既有有效授權內安排聯絡；入列與送達／完成分開。",
      toolNames: ["read_contact_options", "contact_caregiver"], promptModuleIds: ["module.authorized-contact"] },
  ],
} as const;
