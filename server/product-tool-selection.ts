// Select capabilities from user intent, not assistant output or unrelated historical instructions.
export function productToolSelection(texts: readonly string[]) {
  const current = texts.at(-1)?.trim() ?? "";
  const continuation = /^(?:(?:就這樣|就这样|照這個|照这个|照之前|照剛才|照刚才|確認這項|确认这项)(?:[，,。\s]|$)|改成|改為|改为|那就)/u.test(current)
    && current.length <= 120;
  let text = continuation ? texts.slice(-2).join("\n") : current;
  const taskCommand = /(?:建立|新增|安排|更改|修改|改期|取消|完成)\s*(?:一個|一个|一項|一项)?(?:普通|站內|站内)?(?:待辦|待办|任務|任务|提醒)/u.test(text);
  if (taskCommand) {
    // Only explicitly labelled task titles/details are data; other quoted requests remain intent.
    text = text.replace(/((?:待辦|待办|任務|任务|提醒|標題(?:是|為|为)?|标题(?:是|为)?|內容(?:是|為|为)?|内容(?:是|为)?)[：:\s]*)(?:「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*")/gu, "$1");
  }
  text = text.split(/[。；;，,\n]/u).filter(clause => {
    const negative = /^(?:但|也|並且|并且)?\s*(?:不要|不用|無需|无需|勿|別|别)\s*(?:再|替我|幫我|帮我)?\s*(.*)$/u.exec(clause.trim());
    if (!negative || /^(?:忘記|忘记)/u.test(negative[1])) return true;
    if (/(?:但|不過|不过|可是|然而|而是|請|请|直接)/u.test(negative[1])) return true;
    // Only literal prohibitions of known tool actions are omitted; ambiguous instructions stay available.
    return !/^(?:(?:建立|新增|安排)(?:普通)?(?:待辦|待办|任務|任务|提醒|預約|预约)|(?:(?:任何|到期|外部|站外|背景|自動|自动|主動|主动)\s*)*(?:通知|提示|提醒|聯絡|联络|跟進|跟进)|發送|发送|發出|发出|傳送|传送|致電|打電話)/u.test(negative[1]);
  }).join("\n");
  const documents=/準備|准备|成長(?:報告|檔案)|成长(?:报告|档案)|報告|报告|交接|入學|入学|旅行|入園|入园|文件|PDF|document/iu.test(text);
  const concerns=/關注|关注|留意|觀察|观察|跟進|跟进|concern/iu.test(text);
  const sources=/私人(?:來源|来源|資料|资料)|(?:我的|個人|个人)(?:來源|来源)|來源(?:設定|用途|停用)|来源(?:设置|用途|停用)|https?:\/\/|連結|链接|付費|付费/iu.test(text);
  const actions=["read_care_records","read_private_instructions"];
  if(/記錄|记录|記低|記下|记下|奶|餵|喂|睡|尿|食|飲|喝|更正|保存.{0,10}觀察|保存.{0,10}观察/iu.test(text))
    actions.push("save_ordinary_record","revise_ordinary_record");
  if(/記住|记住|偏好|備註|备注|交代|習慣|习惯|以後|以后|長期|长期/iu.test(text))
    actions.push("save_private_instruction","revise_private_instruction");
  const taskIntent=/提醒|預約|预约|任務|任务|待辦|待办|改期|remind/iu.test(text);
  if(taskIntent)
    actions.push("create_ordinary_reminder","change_ordinary_reminder");
  return { includeDocuments:documents, includeConcerns:concerns, includePrivateSources:sources, ordinaryToolNames:actions,
    includeTaskProposals:taskIntent,
    includeContact:/通知|聯絡|联络|發送|发送|telegram|push/iu.test(text) };
}
