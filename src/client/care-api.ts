import type { CarePage, CareRecord, CareRevision, CareSearch, CareValues, ChildProfile, ChildProfileData, HistoryPage } from "../shared/care.ts";

export class CareApiError extends Error {
  readonly status: number;
  constructor(status = 0) {
    super("Care request could not be confirmed");
    this.name = "CareApiError";
    this.status = status;
  }
}

export interface CareApi {
  getSession(signal: AbortSignal): Promise<string | null>;
  getProfile(childId: string, signal: AbortSignal): Promise<ChildProfile>;
  saveProfile(childId: string, data: ChildProfileData, expectedVersion: number, reason: string, signal: AbortSignal, userId: string): Promise<ChildProfile>;
  profileHistory(childId: string, beforeVersion: number | null, signal: AbortSignal): Promise<HistoryPage<ChildProfile>>;
  deleteProfile(childId: string, expectedVersion: number, signal: AbortSignal, userId: string): Promise<ChildProfile>;
  search(childId: string, input: CareSearch, signal: AbortSignal, userId: string): Promise<CarePage>;
  create(childId: string, values: CareValues, signal: AbortSignal, userId: string): Promise<CareRecord>;
  revise(childId: string, recordId: string, values: CareValues, expectedVersion: number, reason: string, signal: AbortSignal, userId: string): Promise<CareRecord>;
  history(childId: string, recordId: string, beforeVersion: number | null, signal: AbortSignal): Promise<HistoryPage<CareRevision>>;
  delete(childId: string, recordId: string, expectedVersion: number, signal: AbortSignal, userId: string): Promise<void>;
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const version = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const string = (value: unknown): value is string => typeof value === "string";
const nullableString = (value: unknown): value is string | null => value === null || string(value);
const age = (value: unknown): boolean => object(value) && (value.kind === "unknown" || (value.kind === "birth_date" && string(value.date)) || (value.kind === "approximate" && string(value.rawValue) && ["days", "weeks", "months", "years"].includes(String(value.unit)) && string(value.asOf)));
const profileData = (value: unknown): value is ChildProfileData => object(value) && age(value.age) && nullableString(value.dueDate) && nullableString(value.gestationalWeeksRaw) && nullableString(value.region) && nullableString(value.language) && nullableString(value.allergies) && nullableString(value.specialNeeds) && nullableString(value.preferences) && string(value.source) && nullableString(value.validUntil);
const profile = (value: unknown): value is ChildProfile => object(value) && string(value.childId) && version(value.version) && (value.data === null || profileData(value.data)) && nullableString(value.confirmedBy) && nullableString(value.confirmedAt) && nullableString(value.reason);
const details = (value: unknown): boolean => object(value) && ["note", "feeding", "sleep", "diaper", "temperature", "measurement", "appointment"].includes(String(value.kind)) && (value.quantity === null || (object(value.quantity) && string(value.quantity.rawValue) && string(value.quantity.unit) && ["exact", "approximate"].includes(String(value.quantity.precision)))) && object(value.eventTime) && string(value.eventTime.rawText) && nullableString(value.eventTime.at) && string(value.eventTime.timeZone) && ["exact", "approximate", "unknown"].includes(String(value.eventTime.precision));
const revision = (value: unknown): value is CareRevision => object(value) && version(value.version) && string(value.text) && string(value.source) && details(value.details) && string(value.confirmedBy) && string(value.confirmedAt) && string(value.reason);
const record = (value: unknown): value is CareRecord => revision(value) && "id" in value && string(value.id) && "childId" in value && string(value.childId) && "authorUserId" in value && string(value.authorUserId) && "createdAt" in value && string(value.createdAt);
function checked<T>(value: unknown, guard: (value: unknown) => value is T): T {
  if (!guard(value)) throw new CareApiError();
  return value;
}
function page<T>(value: unknown, guard: (value: unknown) => value is T): HistoryPage<T> {
  if (!object(value) || !Array.isArray(value.revisions) || !value.revisions.every(guard) || !(value.nextBeforeVersion === null || version(value.nextBeforeVersion))) throw new CareApiError();
  return { revisions: value.revisions, nextBeforeVersion: value.nextBeforeVersion as number | null };
}

export function createCareApi(baseUrl = "", fetcher: typeof fetch = fetch): CareApi {
  const base = baseUrl.replace(/\/$/, "");
  const apiUrl = base.endsWith("/api") ? base : `${base}/api`;
  async function request(path: string, signal: AbortSignal, body?: unknown, userId?: string): Promise<unknown> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    const timeout = setTimeout(abort, 20_000);
    try {
      const response = await fetcher(`${apiUrl}${path}`, {
        method: body === undefined ? "GET" : "POST", credentials: "include", cache: "no-store",
        headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json", "x-expected-user-id": userId ?? "" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal,
      });
      if (!response.ok) throw new CareApiError(response.status);
      return await response.json();
    } catch (error) {
      if (error instanceof CareApiError) throw error;
      throw new CareApiError();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }
  const childPath = (childId: string) => `/children/${encodeURIComponent(childId)}`;
  const historyPath = (beforeVersion: number | null) => beforeVersion === null ? "" : `?beforeVersion=${beforeVersion}`;
  return {
    async getSession(signal) {
      const value = await request("/auth/get-session", signal);
      if (value === null) return null;
      if (!object(value) || !object(value.user) || !string(value.user.id)) throw new CareApiError();
      return value.user.id;
    },
    async getProfile(childId, signal) {
      const value = await request(`${childPath(childId)}/profile`, signal);
      if (!object(value)) throw new CareApiError();
      const result = checked(value.profile, profile);
      if (result.childId !== childId) throw new CareApiError();
      return result;
    },
    async saveProfile(childId, data, expectedVersion, reason, signal, userId) {
      const value = await request(`${childPath(childId)}/profile`, signal, { data, expectedVersion, reason, confirmShared: true }, userId);
      if (!object(value)) throw new CareApiError();
      const result = checked(value.profile, profile);
      if (result.childId !== childId || result.version <= expectedVersion) throw new CareApiError();
      return result;
    },
    async profileHistory(childId, beforeVersion, signal) {
      const result = page(await request(`${childPath(childId)}/profile/history${historyPath(beforeVersion)}`, signal), profile);
      if (result.revisions.some(item => item.childId !== childId)) throw new CareApiError();
      return result;
    },
    async deleteProfile(childId, expectedVersion, signal, userId) {
      const value = await request(`${childPath(childId)}/profile/delete`, signal, { expectedVersion, confirmDelete: true }, userId);
      if (!object(value)) throw new CareApiError();
      const result = checked(value.profile, profile);
      if (result.childId !== childId || result.version <= expectedVersion || result.data !== null) throw new CareApiError();
      return result;
    },
    async search(childId, input, signal, userId) {
      const value = await request(`${childPath(childId)}/care/search`, signal, input, userId);
      if (!object(value) || !Array.isArray(value.records) || !value.records.every(record) || !value.records.every((item: CareRecord) => item.childId === childId) || !(value.nextCursor === null || (object(value.nextCursor) && string(value.nextCursor.createdAt) && string(value.nextCursor.id))) || !version(value.scanned) || !version(value.limit)) throw new CareApiError();
      return value as unknown as CarePage;
    },
    async create(childId, values, signal, userId) {
      const value = await request(`${childPath(childId)}/care`, signal, { ...values, confirmShared: true }, userId);
      if (!object(value)) throw new CareApiError();
      const result = checked(value.record, record);
      if (result.childId !== childId) throw new CareApiError();
      return result;
    },
    async revise(childId, recordId, values, expectedVersion, reason, signal, userId) {
      const value = await request(`${childPath(childId)}/care/${encodeURIComponent(recordId)}/revise`, signal, { ...values, expectedVersion, reason, confirmShared: true }, userId);
      if (!object(value)) throw new CareApiError();
      const result = checked(value.record, record);
      if (result.childId !== childId || result.id !== recordId || result.version <= expectedVersion) throw new CareApiError();
      return result;
    },
    async history(childId, recordId, beforeVersion, signal) {
      return page(await request(`${childPath(childId)}/care/${encodeURIComponent(recordId)}/history${historyPath(beforeVersion)}`, signal), revision);
    },
    async delete(childId, recordId, expectedVersion, signal, userId) {
      const value = await request(`${childPath(childId)}/care/${encodeURIComponent(recordId)}/delete`, signal, { expectedVersion, confirmDelete: true }, userId);
      if (!object(value) || value.deleted !== true) throw new CareApiError();
    },
  };
}
