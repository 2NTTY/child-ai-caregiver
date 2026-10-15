/** Server-authored capability descriptions; user text never selects this catalog. */
export const PRODUCT_AGENT_TOOL_CATALOG = {
  coreToolNames: ["show_official_help", "read_context", "search_knowledge", "read_knowledge_context", "present_answer", "read_work", "request_confirmation"],
  loader: {
    name: "load_capabilities",
    description: "依目前對話、前文指向及工具結果，載入所需的產品能力。可一次選多個能力；載入只提供工具及指引，不執行業務操作或取得授權。需要讀上下文／知識時可在同一輪分別調用讀取與載入；載入成功後才使用新增工具。只載入相關能力，不必按固定順序或把每種能力都載入。",
    parameterDescription: "本次需要的能力 ID；只從 Server 提供的目錄選取，可同時載入多項。",
  },
  groups: [
    { id: "work", description: "保存或更新已讀的同一工作、待答問題及有依據的站內跟進，並查閱背景結果；不是執行業務操作或外發授權。",
      toolNames: ["save_work", "read_background_result"], promptModuleIds: ["module.product-work"] },
    { id: "history", description: "按本人目前可見範圍搜尋、分段讀取前文，區分本人原話與模型；舊內容不能授權重做操作。",
      toolNames: ["search_history", "read_history"], promptModuleIds: ["module.product-history"] },
    { id: "care_records", description: "按家長交代保存或更正普通照護記錄；由 Server 檢查本人預授權及原資源。",
      toolNames: ["read_care_records", "save_ordinary_record", "revise_ordinary_record"], promptModuleIds: ["module.capture-confirmation", "module.product-ordinary-actions"] },
    { id: "memory", description: "讀取本人可見的事實與有效狀態，提出重要事實的新增／更正／停用候選；推測不升格為事實。",
      toolNames: ["propose_fact", "read_memory_facts", "propose_fact_revision", "propose_fact_deactivation"], promptModuleIds: ["module.memory-maintenance"] },
    { id: "private_instructions", description: "讀取、保存或更正本人普通私人交代；按有效預授權及原版本執行，不當作已確認健康事實或家庭通知。",
      toolNames: ["read_private_instructions", "save_private_instruction", "revise_private_instruction"], promptModuleIds: ["module.product-ordinary-actions"] },
    { id: "memory_summary", description: "根據read_context同次完整原訊息批次整理私人衍生摘要；Server綁定覆蓋清單與版本，不提升為事實。",
      toolNames: ["stage_private_summary"], promptModuleIds: ["module.memory-maintenance"] },
    { id: "tasks", description: "安排、改期、取消或完成待辦／提醒；低風險指令按現有授權直接做，其餘提出具體候選。",
      toolNames: ["create_ordinary_reminder", "change_ordinary_reminder", "propose_task", "propose_task_change"], promptModuleIds: ["module.task-intents", "module.product-ordinary-actions"] },
    { id: "documents", description: "查閱本人可見準備單／報告、固定版本正文、歷史及照護摘要；修改或新建時另載對應能力。",
      toolNames: ["read_family_documents", "read_family_document_content", "list_family_document_versions", "read_care_summary"], promptModuleIds: ["module.summary-report"] },
    { id: "document_create", description: "按已讀來源建立新的家庭文件；修改既有文件應載入document_edit，不另建冒充修改。",
      toolNames: ["generate_family_document"], promptModuleIds: ["module.summary-report"] },
    { id: "document_edit", description: "對已核對ID／版本的同一文件作局部修改、勾選或歸檔；正文替換按原候選及確認邊界。需先查原文時同時載入documents。",
      toolNames: ["change_family_document", "propose_family_document_change"], promptModuleIds: ["module.summary-report"] },
    { id: "concerns", description: "查看持續關注及經過，提出建立、追加觀察、結束、恢復或站內跟進候選。",
      toolNames: ["read_concerns", "propose_concern", "propose_concern_change"], promptModuleIds: ["module.product-concerns"] },
    { id: "private_sources", description: "查看本人授權的私人材料與引用，提出來源設定、內容／用途修改或停用候選；不擴大公共或共享範圍。",
      toolNames: ["list_private_sources", "read_private_source", "propose_private_source", "propose_private_source_change"], promptModuleIds: ["module.product-private-sources"] },
    { id: "contact", description: "核對已確認事項的聯絡資格，僅在既有有效授權內安排聯絡；入列與送達／完成分開。",
      toolNames: ["read_contact_options", "contact_caregiver"], promptModuleIds: ["module.authorized-contact"] },
  ],
} as const;

/** A private background event can discover readers, never mutations or external contact. */
export const WORK_CONTINUATION_TOOL_CATALOG = {
  coreToolNames: ["read_context", "search_knowledge", "read_knowledge_context", "present_answer", "read_work", "read_background_result"],
  loader: PRODUCT_AGENT_TOOL_CATALOG.loader,
  groups: [
    { id: "records", description: "讀取照護記錄及本人私人交代；核對原資料，不能新增或更正。", toolNames: ["read_care_records", "read_private_instructions"], promptModuleIds: [] },
    { id: "history", description: "搜尋本人可見歷史並分段讀取原訊息，歷史不代表新的同意。", toolNames: ["search_history", "read_history"], promptModuleIds: [] },
    { id: "memory", description: "讀取本人可見的事實及有效狀態，核對既有工作所依據的資料。", toolNames: ["read_memory_facts"], promptModuleIds: [] },
    { id: "documents", description: "讀取本人可見的準備單／報告、版本及照護摘要；長文按固定版本續讀，不修改或生成文件。", toolNames: ["read_family_documents", "read_family_document_content", "list_family_document_versions", "read_care_summary"], promptModuleIds: [] },
    { id: "concerns", description: "查看目前孩子的持續關注及經過，只核對現況，不建立或更改。", toolNames: ["read_concerns"], promptModuleIds: [] },
    { id: "private_sources", description: "查看本人已授權私人來源及引用，不新增、取得外網正文、修改或擴大分享。", toolNames: ["list_private_sources", "read_private_source"], promptModuleIds: [] },
  ],
} as const;
