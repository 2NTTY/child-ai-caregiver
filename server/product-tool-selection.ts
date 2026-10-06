// Select narrow capabilities from the current conversation; permissions still live in each service.
export function productToolSelection(texts: readonly string[]) {
  const text=texts.slice(-3).join("\n");
  const documents=/準備|准备|成長(?:報告|檔案)|成长(?:报告|档案)|報告|报告|交接|入學|入学|旅行|入園|入园|文件|PDF|document/iu.test(text);
  const concerns=/關注|关注|留意|觀察|观察|跟進|跟进|concern/iu.test(text);
  const sources=/私人(?:來源|来源|資料|资料)|(?:我的|個人|个人)(?:來源|来源)|來源(?:設定|用途|停用)|来源(?:设置|用途|停用)|https?:\/\/|連結|链接|付費|付费/iu.test(text);
  const actions=["read_care_records","read_private_instructions"];
  if(!concerns&&!sources&&!documents || /記錄|记录|記低|记录|保存|奶|餵|喂|睡|尿|食|飲|喝|更正/iu.test(text))
    actions.push("save_ordinary_record","revise_ordinary_record");
  if(/記住|记住|偏好|備註|备注|交代|習慣|习惯|以後|以后|長期|长期/iu.test(text))
    actions.push("save_private_instruction","revise_private_instruction");
  const taskIntent=/提醒|預約|预约|任務|任务|改期|remind/iu.test(text);
  if(taskIntent || !concerns&&!sources&&!documents && /明[天晚早日]|今晚|定時|定时|做完|完成|取消/iu.test(text))
    actions.push("create_ordinary_reminder","change_ordinary_reminder");
  return { includeDocuments:documents, includeConcerns:concerns, includePrivateSources:sources, ordinaryToolNames:actions,
    includeTaskProposals:!concerns&&!sources&&!documents || taskIntent,
    includeContact:!concerns&&!sources&&!documents || /通知|聯絡|联络|發送|发送|telegram|push/iu.test(text) };
}
