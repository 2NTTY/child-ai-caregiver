import { profileAgeUnitOptions, type ProfileDataView, type ProfileViewModel } from "./profile-view-model";

// Optional read projections supplied by the original authorized owners, not new storage or wire contracts.
export type ChildProfileSourceProjection = {
  scopeKey: string;
  childId: string;
  state: "available" | "invalidated" | "unavailable";
};
export type ChildMeasurementFact = {
  valueLabel: string;
  measuredAtLabel: string | null;
  sourceLabel: string | null;
  recordId: string;
  recordVersion: number;
  state: "current" | "expired" | "source_invalidated";
};
export type ChildMeasurementsProjection = {
  scopeKey: string;
  childId: string;
  state: "ready" | "loading" | "error" | "unavailable";
  height: ChildMeasurementFact | null;
  weight: ChildMeasurementFact | null;
};
export type ChildProfileReadingState = "loading" | "no_child" | "access_lost" | "missing" | "source_unavailable" | "source_invalidated" | "expired" | "validity_unknown" | "confirmed";
export type ChildProfileReading = { state: ChildProfileReadingState; data: ProfileDataView | null; statusLabel: string; message: string | null };

export function readChildProfile(model: ProfileViewModel | null, scopeKey: string, today: string, source?: ChildProfileSourceProjection): ChildProfileReading {
  const empty = (state: ChildProfileReadingState, statusLabel: string, message: string | null = null): ChildProfileReading => ({ state, statusLabel, message, data: null });
  if (!model) return empty("loading", "正在讀取檔案");
  if (model.access === "lost") return empty("access_lost", "孩子權限已失效", "舊檔案及來源已清除，請重新核對家庭權限。");
  if (!model.child) return empty("no_child", "尚未有孩子", "可到原子女檔案加入孩子及核對基本資料。");
  // Keep a same-scope confirmed revision during revalidation; source and access
  // checks below still reject unavailable or invalidated authority immediately.
  if (model.reading && !model.current) return empty("loading", "正在讀取檔案");
  if (source && (source.scopeKey !== scopeKey || source.childId !== model.child.id || source.state === "unavailable")) return empty("source_unavailable", "來源暫不可讀", "未能核對這位孩子的原來源，暫不顯示舊資料。");
  if (source?.state === "invalidated") return empty("source_invalidated", "原來源已失效", "這份檔案需要重新核對，舊來源內容不再作為目前資料。");
  if (model.operation.resultUnavailable) return empty("source_unavailable", "原操作已確認，結果不可讀", "請返回原檔案核對；不以舊內容代替目前結果。");
  if (model.reading && (!source || !model.online || model.needsRefresh)) return empty("loading", "正在讀取檔案");
  const data = model.current?.data ?? null;
  if (!data) return empty("missing", "尚未有已確認檔案");
  const validUntil = data.validUntil;
  const validDate = !validUntil || /^\d{4}-\d{2}-\d{2}$/.test(validUntil) && !Number.isNaN(Date.parse(`${validUntil}T00:00:00Z`)) && new Date(`${validUntil}T00:00:00Z`).toISOString().slice(0, 10) === validUntil;
  if (!validDate) return { state: "validity_unknown", data, statusLabel: "有效日期待核對", message: "以下為最後確認資料，資料有效期尚未能核對。" };
  if (validUntil && validUntil < today) return { state: "expired", data, statusLabel: "資料已過有效期", message: `有效期至 ${validUntil}；以下為最後確認資料，請到原檔案核對後更新。` };
  return { state: "confirmed", data, statusLabel: "已確認檔案", message: null };
}

export function childProfileAgeLabel(data: ProfileDataView | null, today?: string): string {
  const age = data?.age;
  if (!age || age.kind === "unknown") return "年齡未知";
  if (age.kind === "birth_date") {
    if (!today) return `出生日期 ${age.date}`;
    const calendarDate = (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
      const date = new Date(`${value}T00:00:00Z`);
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
    };
    const birth = calendarDate(age.date), current = calendarDate(today);
    if (!birth || !current || birth > current) return "出生日期待核對";
    let months = (current.getUTCFullYear() - birth.getUTCFullYear()) * 12 + current.getUTCMonth() - birth.getUTCMonth();
    const anniversaryDay = Math.min(birth.getUTCDate(), new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0)).getUTCDate());
    if (current.getUTCDate() < anniversaryDay) months--;
    if (months < 1) return `${Math.floor((current.getTime() - birth.getTime()) / 86400000)} 日`;
    if (months < 12) return `${months} 個月`;
    return `${Math.floor(months / 12)} 歲${months % 12 ? ` ${months % 12} 個月` : ""}`;
  }
  return `約 ${age.rawValue} ${profileAgeUnitOptions.find(item => item.value === age.unit)?.label ?? age.unit}（截至 ${age.asOf}）`;
}

export function authorizedChildMeasurements(projection: ChildMeasurementsProjection | undefined, scopeKey: string, model: ProfileViewModel | null): ChildMeasurementsProjection | null {
  if (!projection || !scopeKey || !model?.child || model.access === "lost" || projection.scopeKey !== scopeKey || projection.childId !== model.child.id) return null;
  // Loading/error projections never expose retained measurement payloads.
  if (projection.state !== "ready") return { ...projection, height: null, weight: null };
  const readableFact = (fact: ChildMeasurementFact | null) => {
    if (!fact || !fact.recordId || !Number.isSafeInteger(fact.recordVersion) || fact.recordVersion < 1) return null;
    return fact.state === "source_invalidated" ? { ...fact, valueLabel: "", measuredAtLabel: null, sourceLabel: null } : fact;
  };
  return { ...projection, height: readableFact(projection.height), weight: readableFact(projection.weight) };
}
