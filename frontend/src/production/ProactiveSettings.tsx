import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { AppCheckbox } from "../components/AppCheckbox";
import { AppTimeZoneSelect } from "../components/DateTimeFields";
import { AppButton, SectionCard, SectionHeader } from "../components/ui";
import { chineseFont, colors, readingType, spacing } from "../theme";
import { useDomainEnvironment, useDomainWriteGuard } from "./useDomainEnvironment";
import { settingsAccessError, useSettingsRequests } from "./SettingsDomainSupport";
import { createProactiveSettingsApi, firstEnableTimeZone, type ProactiveSettings } from "./proactive-settings-api";

export function ProactiveSettings({ active }: { active: boolean }) {
  const env = useDomainEnvironment(), requests = useSettingsRequests(env);
  const api = useMemo(() => createProactiveSettingsApi(env.apiBaseUrl, env.owner.fetcher), [env.apiBaseUrl, env.owner.fetcher]);
  const [saved, setSaved] = useState<ProactiveSettings | null>(null), [draft, setDraft] = useState<ProactiveSettings | null>(null), [notice, setNotice] = useState("");
  const draftRef = useRef(draft), savedRef = useRef(saved); draftRef.current = draft; savedRef.current = saved;
  const dirty = !!draft && !!saved && (draft.enabled !== saved.enabled || draft.timeZone !== saved.timeZone);
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const refresh = async (replaceDraft = false) => {
    if (env.sharedMode || !env.childId || !env.userId) return;
    const request = requests.start(); if (!request) return;
    try {
      const next = await api.read(env.childId, env.userId, request.signal); if (!request.current()) return;
      setSaved(next); if (replaceDraft || !dirtyRef.current || !draftRef.current) setDraft(next);
      setNotice("目前主動助手設定已讀取。");
    } catch (error) { if (request.current()) { if (settingsAccessError(env, error, true)) { setSaved(null); setDraft(null); } setNotice("主動助手設定未能讀取；請重新核對。"); } }
    finally { request.finish(); }
  };
  useEffect(() => { if (active) void refresh(); }, [active]);
  useDomainWriteGuard(dirty, requests.writing, "child");
  const save = async () => {
    const original = draftRef.current, current = savedRef.current;
    if (!original || !current || original.version !== current.version || env.sharedMode || !env.childId || !env.userId) return;
    const request = requests.start(true); if (!request) return;
    try {
      const next = await api.save(env.childId, env.userId, request.signal, { enabled: original.enabled, timeZone: original.timeZone, expectedVersion: current.version, opId: crypto.randomUUID() });
      if (!request.current()) return; setSaved(next); setDraft(next); setNotice("主動助手設定已保存。");
    } catch (error) {
      if (!request.current()) return;
      if (settingsAccessError(env, error, true)) { setSaved(null); setDraft(null); setNotice("目前沒有修改此設定的權限，請重新讀取。"); return; }
      try {
        const next = await api.read(env.childId, env.userId, request.signal); if (!request.current()) return;
        setSaved(next); setDraft(next); setNotice("原保存未能確認，已重新讀取目前設定。沒有自動重送；請核對後再選擇。");
      } catch { if (request.current()) { setSaved(null); setNotice("原保存結果未知；請重新讀取目前設定後再選擇，不會自動重送。"); } }
    } finally { request.finish(); }
  };
  if (env.sharedMode) return null;
  const locked = !env.online || requests.busy || !saved || !draft;
  return <SectionCard><SectionHeader title="主動助手" density="compact" subtitle="按孩子及本人分開設定，預設關閉。" />
    <View style={styles.contents}>
      <Text style={styles.meta}>開啟後，助手會按目前授權讀取這位孩子的資料，並在原聊天向本人提問、聯絡及跟進檢查。操作或修改資料須由你另行交代及確認。手機聊天通知另按每部手機設定。</Text>
      <AppCheckbox label="為這位孩子開啟本人的主動助手" checked={draft?.enabled === true} disabled={locked}
        onChange={enabled => setDraft(value => value ? { ...value, enabled, timeZone: enabled && !value.enabled ? firstEnableTimeZone(value) : value.timeZone } : null)} />
      <AppTimeZoneSelect value={draft?.timeZone ?? "Asia/Hong_Kong"} disabled={locked} onChange={timeZone => setDraft(value => value ? { ...value, timeZone } : null)} />
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.meta}>{notice}</Text> : null}
      {draft && saved && draft.version !== saved.version ? <Text accessibilityRole="alert" style={styles.meta}>設定版本已改變，請重新讀取並採用目前設定後再選擇。</Text> : null}
      <View style={styles.actions}><AppButton label="保存主動助手設定" disabled={locked || !dirty || draft?.version !== saved?.version} onPress={() => { void save(); }} />
        <AppButton label="重新讀取並採用目前設定" variant="quiet" disabled={!env.online || requests.busy} onPress={() => { void refresh(true); }} /></View>
    </View>
  </SectionCard>;
}
const styles = StyleSheet.create({ contents: { gap: spacing.md }, actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta } });
