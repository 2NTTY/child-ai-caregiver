import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { FamilySpace, InvitationPreview, MemberRole, NotificationPreferences } from "../shared/family.ts";
import { createFamilyApi, FamilyApiError } from "./family-api.ts";

interface Props { userId: string; online: boolean; apiBaseUrl: string; onChanged: () => void }
type PendingMember = { userId: string; name: string; role: MemberRole | "revoked" };
interface PanelData {
  scope: string;
  families: FamilySpace[];
  preferences: NotificationPreferences | null;
}
const empty = (scope: string): PanelData => ({ scope, families: [], preferences: null });
const roleName = { owner: "擁有者", caregiver: "照顧者", viewer: "檢視者", revoked: "撤銷權限" };
const scopeText = "加入後可查看這個家庭的全部孩子及共享照顧記錄；不包括其他人的私人 AI 聊天。日後新增到這個家庭的孩子及共享記錄亦屬同一共享範圍。";

function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}

export function FamilyPanel({ userId, online, apiBaseUrl, onChanged }: Props) {
  const scope = `${userId}\n${apiBaseUrl}`;
  const api = useMemo(() => createFamilyApi(apiBaseUrl), [apiBaseUrl]);
  const generation = useRef(0);
  const requests = useRef(new Set<AbortController>());
  const inFlight = useRef(false);
  const selectedIdRef = useRef<string | null>(null);
  const [data, setData] = useState<PanelData>(() => empty(scope));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("caregiver");
  const [shareConfirmed, setShareConfirmed] = useState(false);
  const [createdToken, setCreatedToken] = useState("");
  const [incomingToken, setIncomingToken] = useState("");
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [pendingMember, setPendingMember] = useState<PendingMember | null>(null);
  const [childName, setChildName] = useState("");
  const [timeZone, setTimeZone] = useState("Asia/Hong_Kong");
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("08:00");
  const [allowAppointmentDuringQuiet, setAllowAppointmentDuringQuiet] = useState(false);

  const clearPrivate = useCallback(() => {
    selectedIdRef.current = null;
    setData(empty(scope)); setSelectedId(null); setCreatedToken(""); setIncomingToken("");
    setPreview(null); setInviteEmail(""); setShareConfirmed(false); setPendingMember(null); setChildName("");
    setTimeZone("Asia/Hong_Kong"); setQuietStart("22:00"); setQuietEnd("08:00"); setAllowAppointmentDuringQuiet(false);
  }, [scope]);

  const verified = useCallback(async <T,>(operation: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> => {
    const result = await operation(signal);
    if (await api.getSession(signal) !== userId) throw new FamilyApiError(401);
    return result;
  }, [api, userId]);

  const run = async (kind: string, operation: (signal: AbortSignal, current: () => boolean) => Promise<void>, write = false) => {
    if (!online || busy || inFlight.current || (write && uncertain)) return;
    inFlight.current = true;
    const currentGeneration = generation.current;
    const controller = new AbortController();
    requests.current.add(controller);
    const current = () => generation.current === currentGeneration && !controller.signal.aborted;
    setBusy(kind); setNotice("");
    try {
      await operation(controller.signal, current);
    } catch (error) {
      if (!current()) return;
      const status = error instanceof FamilyApiError ? error.status : 0;
      if (kind === "預覽邀請" || kind === "接受邀請") setPreview(null);
      if (status === 401 || status === 403) {
        clearPrivate(); setUncertain(false); setNotice("登入或權限已改變，家庭資料已清除。請重新登入並讀取。");
      } else if (status === 404) {
        clearPrivate(); setUncertain(false); setNotice("邀請已失效或家庭權限已改變，資料已清除。請重新讀取。");
        onChanged();
      } else if (status === 409) {
        setCreatedToken(""); setPreview(null); setPendingMember(null);
        setUncertain(true);
        try {
          await reload(controller.signal, current);
          if (current()) setNotice("資料版本已改變，已重新讀取。請核對最新資料後再作決定。");
        } catch (reloadError) {
          if (!current()) return;
          const reloadStatus = reloadError instanceof FamilyApiError ? reloadError.status : 0;
          if (reloadStatus === 401 || reloadStatus === 403 || reloadStatus === 404) clearPrivate();
          if (reloadStatus === 404) onChanged();
          setNotice(reloadStatus === 401 || reloadStatus === 403 || reloadStatus === 404
            ? "登入或權限已改變，家庭資料已清除。"
            : "資料版本已改變，但重新讀取失敗；請手動重新讀取後核對。");
        }
      } else if (status === 400 || status === 415 || status === 428) {
        setNotice(status === 428 ? "登入帳號未確認，請重新確認帳號後提交。" : "輸入未被接納，請核對內容後再提交。");
      } else if (status >= 400 && status < 500) {
        setNotice("請求未被接納，請核對後再試。");
      } else {
        if (write) setUncertain(true);
        setNotice(write ? "提交結果未能確認。請先重新讀取並核對，系統不會自動重送。" : "讀取失敗，請稍後重新讀取。");
      }
    } finally {
      requests.current.delete(controller);
      if (current()) { inFlight.current = false; setBusy(null); }
    }
  };

  const reload = useCallback(async (signal: AbortSignal, current: () => boolean) => {
    const families = await verified(next => api.listFamilies(next), signal);
    if (!current()) return;
    const previousSelected = families.find(item => item.id === selectedIdRef.current);
    if (!previousSelected || previousSelected.role !== "owner") {
      setCreatedToken(""); setPendingMember(null); setShareConfirmed(false);
    }
    const nextSelectedId = previousSelected?.id ?? families[0]?.id ?? null;
    selectedIdRef.current = nextSelectedId;
    setData(previous => ({ ...previous, scope, families }));
    setSelectedId(nextSelectedId);
    const preferences = await verified(next => api.getPreferences(next), signal);
    if (!current()) return;
    setData({ scope, families, preferences });
    setTimeZone(preferences.timeZone); setQuietStart(preferences.quietStart); setQuietEnd(preferences.quietEnd);
    setAllowAppointmentDuringQuiet(preferences.allowAppointmentDuringQuiet);
    setUncertain(false);
  }, [api, scope, verified]);

  useEffect(() => {
    generation.current += 1;
    for (const request of requests.current) request.abort();
    requests.current.clear();
    inFlight.current = false;
    clearPrivate(); setBusy(null); setNotice(""); setUncertain(false);
    if (online) {
      const currentGeneration = generation.current;
      const controller = new AbortController();
      requests.current.add(controller);
      inFlight.current = true;
      setBusy("讀取");
      void reload(controller.signal, () => generation.current === currentGeneration && !controller.signal.aborted)
        .catch(error => {
          if (generation.current !== currentGeneration || controller.signal.aborted) return;
          const status = error instanceof FamilyApiError ? error.status : 0;
          if (status === 401 || status === 403 || status === 404) clearPrivate();
          if (status === 404) onChanged();
          setNotice(status === 401 || status === 403 || status === 404 ? "登入或權限已改變，家庭資料已清除。" : "家庭資料讀取失敗，請重新讀取。");
        }).finally(() => {
          requests.current.delete(controller);
          if (generation.current === currentGeneration && !controller.signal.aborted) { inFlight.current = false; setBusy(null); }
        });
    }
    return () => {
      generation.current += 1;
      for (const request of requests.current) request.abort();
      requests.current.clear();
      inFlight.current = false;
    };
  }, [scope, online, reload, clearPrivate]);

  const refresh = () => { void run("讀取", reload); };
  const selected = data.scope === scope ? data.families.find(item => item.id === selectedId) ?? null : null;
  const preferences = data.scope === scope ? data.preferences : null;
  const ready = online && !busy && !uncertain;
  const timeValid = /^([01]\d|2[0-3]):[0-5]\d$/;

  const mutate = (kind: string, operation: (signal: AbortSignal) => Promise<void>, after: () => void) => {
    void run(kind, async (signal, current) => {
      await verified(operation, signal);
      if (!current()) return;
      after();
      onChanged();
      await reload(signal, current);
    }, true);
  };

  if (data.scope !== scope) return null;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>家庭管理</Text>
    <Text style={styles.hint}>家庭權限以 Server 為準。更改後請核對重新讀取的資料。</Text>
    <Action label={busy === "讀取" ? "正在讀取…" : "重新讀取家庭與通知偏好"} onPress={refresh} disabled={!online || !!busy} />
    {!online && <Text style={styles.warning}>目前離線，不能讀取或提交。</Text>}
    {uncertain && <Text style={styles.warning}>請先重新讀取並核對結果，之後才可再次提交。</Text>}
    {!!notice && <Text accessibilityRole="alert" style={styles.warning}>{notice}</Text>}
    <Text accessibilityRole="header" style={styles.heading}>我的家庭</Text>
    {data.families.length === 0 && <Text style={styles.body}>尚未找到家庭，或資料仍在讀取。可先到下方建立孩子，或輸入邀請碼加入現有家庭。</Text>}
    <View style={styles.row}>{data.families.map(item => <Action key={item.id}
      label={`${item.id === selectedId ? "目前：" : ""}${item.ownerName}的家庭（${roleName[item.role]}）`}
      onPress={() => { selectedIdRef.current = item.id; setSelectedId(item.id); setCreatedToken(""); setShareConfirmed(false); setPendingMember(null); }} disabled={!!busy || item.id === selectedId} />)}</View>
    {selected && <View style={styles.group}>
      <Text style={styles.label}>目前角色：{roleName[selected.role]}</Text>
      <Text style={styles.hint}>{scopeText}</Text>
      <Text style={styles.label}>成員</Text>
      {selected.members.map(member => <View key={member.userId} style={styles.member}>
        <Text style={styles.body}>{member.name}（{roleName[member.role]}）</Text>
        {selected.role === "owner" && member.role !== "owner" && member.userId !== userId && <View style={styles.row}>
          {(["caregiver", "viewer", "revoked"] as const).filter(value => value !== member.role).map(value =>
            <Action key={value} label={roleName[value]} onPress={() => setPendingMember({ userId: member.userId, name: member.name, role: value })} disabled={!ready} />)}
        </View>}
      </View>)}
      {pendingMember && selected.role === "owner" && <View style={styles.confirmation}>
        <Text style={styles.warning}>確認將「{pendingMember.name}」設為{roleName[pendingMember.role]}？{pendingMember.role === "revoked" ? "此人將失去家庭資料權限。" : scopeText}</Text>
        <Action label="再次確認更改成員權限" disabled={!ready} onPress={() => mutate("更改權限", signal => api.changeMember(selected.id, pendingMember.userId, pendingMember.role, selected.version, signal, userId), () => setPendingMember(null))} />
        <Action label="取消" onPress={() => setPendingMember(null)} />
      </View>}
      {selected.role === "owner" && <View style={styles.group}>
        <Text accessibilityRole="header" style={styles.heading}>邀請成員</Text>
        <Text style={styles.warning}>{scopeText}</Text>
        <Text style={styles.hint}>邀請碼有效七日，只顯示一次；系統不會發電郵，請自行以安全方式交給指定收件人。</Text>
        <TextInput accessibilityLabel="受邀人的電郵" autoCapitalize="none" keyboardType="email-address" value={inviteEmail} onChangeText={value => { setInviteEmail(value); setShareConfirmed(false); }} editable={!busy} style={styles.input} />
        <View style={styles.row}>{(["caregiver", "viewer"] as const).map(value => <Action key={value}
          label={`${inviteRole === value ? "已選：" : ""}${roleName[value]}`} onPress={() => { setInviteRole(value); setShareConfirmed(false); }} disabled={!!busy} />)}</View>
        <Action label={shareConfirmed ? "已確認共享範圍" : "我已確認以上共享範圍及收件人"} onPress={() => setShareConfirmed(value => !value)} disabled={!!busy} />
        <Action label="建立一次性邀請碼" disabled={!ready || !shareConfirmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim())}
          onPress={() => {
            const email = inviteEmail.trim();
            void run("建立邀請", async (signal, current) => {
              const result = await verified(next => api.createInvitation(selected.id, email, inviteRole, selected.version, next, userId), signal);
              if (!current()) return;
              setCreatedToken(result.token); setShareConfirmed(false); setInviteEmail(""); onChanged();
              await reload(signal, current);
            }, true);
          }} />
        {!!createdToken && <View style={styles.confirmation}>
          <Text style={styles.label}>邀請碼（請立即安全分享）</Text><Text selectable style={styles.token}>{createdToken}</Text>
          <Action label="清除邀請碼" onPress={() => setCreatedToken("")} />
        </View>}
        <Text style={styles.label}>待接受邀請</Text>
        {selected.invitations.filter(item => item.status === "pending").map(item => <View key={item.id} style={styles.member}>
          <Text style={styles.body}>{item.email}（{roleName[item.role]}；到期：{new Date(item.expiresAt).toLocaleString("zh-HK", { hour12: false })}）</Text>
          <Action label="撤銷邀請" disabled={!ready} onPress={() => mutate("撤銷邀請", signal => api.revokeInvitation(selected.id, item.id, selected.version, signal, userId), () => setCreatedToken(""))} />
        </View>)}
      </View>}
      {(selected.role === "owner" || selected.role === "caregiver") && <View style={styles.group}>
        <Text accessibilityRole="header" style={styles.heading}>在此家庭建立孩子</Text>
        <TextInput accessibilityLabel="新孩子的稱呼" value={childName} onChangeText={setChildName} editable={!busy} style={styles.input} />
        <Action label="確認建立孩子" disabled={!ready || !childName.trim() || childName.trim().length > 80}
          onPress={() => mutate("建立孩子", signal => api.createChild(selected.id, childName.trim(), signal, userId).then(() => undefined), () => setChildName(""))} />
      </View>}
    </View>}
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>使用邀請碼加入家庭</Text>
      <TextInput accessibilityLabel="收到的邀請碼" value={incomingToken} onChangeText={value => { setIncomingToken(value); setPreview(null); }} editable={!busy} style={styles.input} />
      <Action label="預覽邀請" disabled={!ready || !incomingToken.trim()} onPress={() => { void run("預覽邀請", async (signal, current) => {
        const result = await verified(next => api.previewInvitation(incomingToken.trim(), next, userId), signal);
        if (current()) setPreview(result);
      }); }} />
      {preview && <View style={styles.confirmation}>
        <Text style={styles.body}>擁有者：{preview.ownerName}；你的角色：{roleName[preview.role]}；到期：{new Date(preview.expiresAt).toLocaleString("zh-HK", { hour12: false })}</Text>
        <Text style={styles.warning}>{scopeText}</Text>
        <Action label="我已檢視共享範圍，確認加入此家庭" disabled={!ready} onPress={() => mutate("接受邀請", signal => api.acceptInvitation(incomingToken.trim(), preview.workspaceId, signal, userId), () => { setIncomingToken(""); setPreview(null); })} />
      </View>}
    </View>
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>我的通知偏好</Text>
      <Text style={styles.hint}>這些只是個人偏好設定，不代表已授權對外發送或已開通任何通知渠道。</Text>
      <Text style={styles.label}>時區</Text><TextInput accessibilityLabel="通知時區" value={timeZone} onChangeText={setTimeZone} editable={!busy} style={styles.input} />
      <Text style={styles.label}>安靜時段開始（HH:mm）</Text><TextInput accessibilityLabel="安靜時段開始" value={quietStart} onChangeText={setQuietStart} editable={!busy} style={styles.input} />
      <Text style={styles.label}>安靜時段結束（HH:mm）</Text><TextInput accessibilityLabel="安靜時段結束" value={quietEnd} onChangeText={setQuietEnd} editable={!busy} style={styles.input} />
      <Action label={`容許已明確設定的預約提醒在安靜時段內發送：${allowAppointmentDuringQuiet ? "是" : "否"}`}
        onPress={() => setAllowAppointmentDuringQuiet(value => !value)} disabled={!!busy} />
      <Action label="保存個人通知偏好" disabled={!ready || !preferences || !timeZone.trim() || !timeValid.test(quietStart) || !timeValid.test(quietEnd)}
        onPress={() => mutate("保存偏好", async signal => { await api.savePreferences({ timeZone: timeZone.trim(), quietStart, quietEnd, allowAppointmentDuringQuiet, expectedVersion: preferences!.version }, signal, userId); }, () => undefined)} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, padding: 16, borderWidth: 1, borderColor: "#d6dfdc", borderRadius: 10, marginTop: 20 },
  group: { gap: 8, padding: 12, backgroundColor: "#f7faf8", borderRadius: 8 },
  member: { gap: 6, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#e1e8e4" },
  confirmation: { gap: 8, padding: 10, borderWidth: 1, borderColor: "#b88132", borderRadius: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  heading: { fontSize: 20, fontWeight: "700", color: "#183f35" },
  label: { fontSize: 15, fontWeight: "600", color: "#203e35" },
  body: { fontSize: 15, color: "#24352e" },
  hint: { fontSize: 13, color: "#465c52" },
  warning: { fontSize: 14, color: "#80501b" },
  input: { borderWidth: 1, borderColor: "#a8b9b0", borderRadius: 6, padding: 9, backgroundColor: "#fff", color: "#183f35" },
  token: { fontSize: 16, color: "#183f35", backgroundColor: "#fff", padding: 8 },
  button: { backgroundColor: "#275e4e", paddingHorizontal: 12, paddingVertical: 9, borderRadius: 6, alignSelf: "flex-start" },
  buttonText: { color: "#fff", fontWeight: "600" },
  disabled: { opacity: 0.45 },
});
