import type { HomeChild } from "../view-model";
import type { PreparationDocument, PreparationOwnerState, PreparationPurpose, PreparationSection } from "../preparation-view-model.ts";

const previewUpdatedAt = "2026-10-05T06:00:00Z";
const sections = (purpose: PreparationPurpose): PreparationSection[] => {
  const content: Record<PreparationPurpose, { notes: string[]; questions: string[]; checklist: string[]; noteTitle: string }> = {
    appointment: { noteTitle: "想和醫護談的近況", notes: ["這份示例整理家長想討論的作息和日常觀察，沒有醫療判斷。", "預約時間和地點尚未核實，出發前請查看機構的確認資料。"],
      questions: ["這段時間的作息有哪些值得持續記下的地方？", "下次覆診前需要帶甚麼觀察或紀錄？"], checklist: ["核對預約時間及診所位置", "帶備預約資料及所需證件", "把想補問的問題留在手機上"] },
    school: { noteTitle: "讓老師先認識孩子", notes: ["示例交接重點：熟悉的日常次序，以及慢慢適應新環境的方法。", "過敏、用藥及校方安排未提供；不能把未提供當作沒有。"],
      questions: ["首週接送及陪伴安排是怎樣？", "家長可以用甚麼方式向老師補充當天情況？"], checklist: ["核對迎新日期及接送安排", "準備校方列明的物品", "確認哪些資料需要由家長交給學校"] },
    outing: { noteTitle: "出發前看一眼", notes: ["示例安排：上午公園散步，按孩子當天狀態調整停留時間。", "目的地開放情況、交通及天氣尚未核實。"],
      questions: ["同行的人怎樣聯絡和會合？", "如果需要提早回家，備用安排是甚麼？"], checklist: ["確認路線、會合時間及回程方法", "整理飲水、替換衣物及日常用品", "核對隨身物品並告知同行的人"] },
    handoff: { noteTitle: "交接時先說這幾件事", notes: ["示例重點：今天大致的作息，以及離開前需要親口確認的事項。", "接手的人、緊急聯絡方法及特別照顧安排未提供，交接前需核對。"],
      questions: ["下一次進食、休息和接送要留意甚麼？", "有變動時先聯絡誰？"], checklist: ["雙方確認交接及接回時間", "指出用品放在哪裏", "確認聯絡方法和未完成的事情"] },
  };
  const value = content[purpose];
  return [
    { id: "notes", title: value.noteTitle, kind: "notes", items: value.notes.map((text, index) => ({ id: `note-${index}`, text })) },
    { id: "questions", title: "想問／想確認", kind: "questions", items: value.questions.map((text, index) => ({ id: `question-${index}`, text })) },
    { id: "checklist", title: "出發／交接前清單", kind: "checklist", items: value.checklist.map((text, index) => ({ id: `check-${index}`, text, checked: false })) },
  ];
};

function document(child: HomeChild, purpose: PreparationPurpose, title: string, eventDate: string | null, archived = false): PreparationDocument {
  const id = `preview-preparation:${child.id}:${purpose}${archived ? ":past" : ""}`, revisionId = `${id}:revision:1`;
  return { id, childId: child.id, purpose, version: 1, status: archived ? "archived" : "active",
    currentRevisionId: revisionId, archivedRevisionId: archived ? revisionId : null, archivedAt: archived ? "2026-09-27T09:00:00Z" : null,
    revisions: [{ id: revisionId, number: 1, title, eventDate, updatedAt: archived ? "2026-09-26T06:00:00Z" : previewUpdatedAt,
      sourceAsOf: archived ? "2026-09-26T06:00:00Z" : previewUpdatedAt,
      summary: purpose === "appointment" ? "把這次想談的近況、問題和出門前清單放在一起。"
        : purpose === "school" ? "先看孩子的適應需要，再核對校方安排。"
          : purpose === "outing" ? "出發前在手機打開，逐項看安排和物品。" : "交接時按這張單說清重點，未確認的地方留待雙方補充。",
      sections: sections(purpose), sourceRefs: [{ id: `preview-preparation-source:${child.id}${archived ? ":history" : ""}`, version: 1 }] }],
  };
}

export function createPreparationFixture(authorityKey: string, children: readonly HomeChild[]): PreparationOwnerState {
  // Only declared preview children have prepared fixtures. A newly created child has no invented documents.
  const fixtureChildren = children.filter(child => ["preview-child-1", "preview-child-2"].includes(child.id));
  return { authorityKey,
    sources: fixtureChildren.flatMap(child => [{ id: `preview-preparation-source:${child.id}`, childId: child.id,
      label: "準備單版面示例", version: 1, updatedAt: previewUpdatedAt, state: "available" as const, visibility: "family" as const, provenance: "synthetic_preview" as const },
    { id: `preview-preparation-source:${child.id}:history`, childId: child.id,
      label: "過往準備單版面示例", version: 1, updatedAt: "2026-09-26T06:00:00Z", state: "available" as const, visibility: "family" as const, provenance: "synthetic_preview" as const }]),
    documents: fixtureChildren.flatMap(child => [
      document(child, "appointment", `${child.displayName}的到診準備`, "2026-10-08"),
      document(child, "school", `${child.displayName}的迎新準備`, "2026-10-12"),
      document(child, "outing", "週末公園半日遊", "2026-10-10"),
      document(child, "handoff", "週末照顧交接", null),
      document(child, "outing", "上次外出準備", "2026-09-27", true),
    ]),
  };
}
