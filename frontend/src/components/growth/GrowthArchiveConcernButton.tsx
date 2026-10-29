import { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { Text } from "react-native-paper";
import type { GrowthConcern } from "../../growth-view-model";
import { growthConcernArchiveReachesCapacity } from "../../growth-view-model";
import { AppDialog } from "../AppDialog";
import { AppButton } from "../ui";
import { growthStyles as s } from "./growth-styles";

type ArchiveReview = { key: string; title: string; confirm: () => void };

// Opening or dismissing this dialog never writes. Consent belongs to one exact displayed basis.
export function GrowthArchiveConcernButton({ concern, scopeKey, authorityVersion, disabled, onConfirm }: {
  concern: GrowthConcern; scopeKey: string; authorityVersion: string; disabled: boolean; onConfirm: () => void;
}) {
  const key = JSON.stringify([scopeKey, concern.childId, concern.id, concern.version, concern.status, authorityVersion]);
  const [review, setReview] = useState<ArchiveReview | null>(null);
  const reviewRef = useRef(review), alive = useRef(true);
  const current = useRef({ key, disabled, onConfirm }); current.current = { key, disabled, onConfirm };
  const valid = !!review && review.key === key && !disabled && concern.status !== "closed";
  function cancel() { reviewRef.current = null; setReview(null); }
  useEffect(() => {
    if (review && !valid) cancel();
  }, [key, disabled, valid]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; reviewRef.current = null; }; }, []);
  function open() {
    if (!alive.current || current.current.key !== key || current.current.disabled || concern.status === "closed") return;
    const next = { key, title: concern.title, confirm: onConfirm };
    reviewRef.current = next; setReview(next);
  }
  function confirm() {
    if (!alive.current || !review || reviewRef.current !== review || current.current.key !== review.key || current.current.disabled) return;
    // Consume this confirmation synchronously, including repeated pointer/keyboard activation.
    reviewRef.current = null; setReview(null); review.confirm();
  }
  return <>
    <AppButton label="結束關注" accessibilityLabel={`結束關注：${concern.title}`} variant="quiet" style={a.managementAction} disabled={disabled} onPress={open} />
    <AppDialog visible={valid} onDismiss={cancel} danger accessibilityLabel={`確認結束關注：${review?.title ?? concern.title}`} testID="growth-archive-confirmation">
      <AppDialog.Title danger>結束這條關注？</AppDialog.Title>
      <AppDialog.Content><Text style={s.title}>「{review?.title ?? concern.title}」</Text>
        <Text style={s.body}>{growthConcernArchiveReachesCapacity(concern) ? "此關注結束後將無法恢復繼續記錄，完整歷史仍會保留。" : "內容會保留在歷史，可撤銷或恢復；不影響已連結的任務。"}</Text>
        {growthConcernArchiveReachesCapacity(concern) ? <Text style={s.body}>不會刪除記錄，也不會完成或取消已連結的任務。</Text> : null}
      </AppDialog.Content>
      <AppDialog.Actions>
        <AppButton label="取消" variant="quiet" onPress={cancel} />
        <AppButton label="確認結束關注" variant="danger" style={a.action} disabled={!valid} onPress={confirm} />
      </AppDialog.Actions>
    </AppDialog>
  </>;
}

const a = StyleSheet.create({ managementAction: { alignSelf: "flex-start", borderWidth: 0 }, action: { alignSelf: "flex-start", borderWidth: 0 } });
