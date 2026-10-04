import { usePreviewLeaveGuard } from "../preview/PreviewNavigationGuard";
import { useId, useState } from "react";
import { StyleSheet, View } from "react-native";
import { HelperText, Text } from "react-native-paper";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { usePreviewOperation } from "../preview/usePreviewOperation";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";
import { MotionDisclosure } from "../motion";
import { AppButton, AppTextField } from "./ui";
import { PreviewWriteControls, PreviewWriteNotice } from "./PreviewWritePanel";

const schema = z.object({ displayName: z.string().trim().refine(value => [...value].length >= 1 && [...value].length <= 80, "請填 1 至 80 字的孩子稱呼。") });
export function CreateChildPreview({ online, enabled = true, onCreated }: { online: boolean; enabled?: boolean; onCreated: (displayName: string) => void }) {
  const [open, setOpen] = useState(false);
  const motionScope = useId();
  const [review, setReview] = useState<string | null>(null);
  const op = usePreviewOperation();
  const form = useForm({ defaultValues: { displayName: "" }, resolver: zodResolver(schema) });
  usePreviewLeaveGuard(form.formState.isDirty);
  return <View style={styles.root}><AppButton label={open ? "收起新增孩子" : "新增孩子"} variant="secondary" disabled={op.locked || !enabled} onPress={() => setOpen(value => !value)} />
    <MotionDisclosure expanded={open} scopeKey={motionScope} testID="create-child-disclosure"><View style={styles.form}><Text style={styles.body}>合成新增示例。只需要稱呼；其他未知資料不會推算。正式建立由現有家庭／孩子 API 處理。</Text>
      <PreviewWriteNotice controller={op} online={online} />
      <Controller name="displayName" control={form.control} render={({ field, fieldState }) => <View><AppTextField ref={field.ref} label="孩子稱呼" accessibilityLabel="新增孩子稱呼" value={field.value} onBlur={field.onBlur} disabled={op.locked || !enabled} error={!!fieldState.error} onChangeText={value => { field.onChange(value); setReview(null); op.edit(); }} />{fieldState.error ? <HelperText type="error">{fieldState.error.message}</HelperText> : null}</View>} />
      <AppButton label="預覽新增孩子" disabled={op.locked || !enabled} onPress={form.handleSubmit(values => { setReview(values.displayName); op.review(); })} />
      {review && op.operation.state === "needs_confirmation" ? <View style={styles.review}><Text style={styles.body}>將在這個合成家庭加入「{review}」。家庭成員可按角色查看現在及日後的共享孩子資料；私人聊天不會共享。</Text><AppButton label="確認並模擬新增孩子" disabled={!online || !enabled} onPress={() => op.submit(() => { onCreated(review); form.reset({ displayName: "" }); setReview(null); })} /></View> : null}
      <PreviewWriteControls controller={op} conflict={false} />
    </View></MotionDisclosure>
  </View>;
}
const styles = StyleSheet.create({ root: { gap: spacing.md }, form: { gap: spacing.md }, body: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 23 }, review: { backgroundColor: colors.paleAmber, borderRadius: radius.small, padding: spacing.md, gap: spacing.md } });
