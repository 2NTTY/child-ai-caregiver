import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { AgentProposalDraftEditInput, AgentProposalEditableDraft } from "../../agent-view-model";
import { chineseFont, colors, radius, readingType, spacing } from "../../theme";
import { AppButton, AppTextField } from "../ui";

/** Inline draft editor for pre-confirmation proposal edits before binding confirmation. */
export function ProposalDraftEditor({
  proposalId,
  draft,
  disabled,
  busy,
  onSave,
  onCancel,
}: {
  proposalId: string;
  draft: AgentProposalEditableDraft;
  disabled: boolean;
  busy: boolean;
  onSave(input: AgentProposalDraftEditInput): Promise<boolean> | void;
  onCancel(): void;
}) {
  const [title, setTitle] = useState(draft.title ?? "");
  const [content, setContent] = useState(draft.content);
  const [reason, setReason] = useState(draft.reason ?? "");

  const hasTitle = draft.title !== undefined;
  const hasReason = draft.reason !== undefined;
  const trimmedTitle = title.trim();
  const trimmedContent = content.trim();
  const trimmedReason = reason.trim();

  const maxTitle = draft.maxTitleLength ?? 160;
  const maxReason = draft.maxReasonLength ?? 1000;

  let error: string | null = null;
  if (hasTitle && trimmedTitle.length === 0) {
    error = `請輸入${draft.titleLabel ?? "標題"}。`;
  } else if (hasTitle && trimmedTitle.length > maxTitle) {
    error = `${draft.titleLabel ?? "標題"}不可超過 ${maxTitle} 字。`;
  } else if (!draft.allowEmptyContent && trimmedContent.length === 0) {
    error = `請輸入${draft.contentLabel}。`;
  } else if (trimmedContent.length > draft.maxContentLength) {
    error = `${draft.contentLabel}不可超過 ${draft.maxContentLength} 字。`;
  } else if (hasReason && trimmedReason.length === 0) {
    error = `請輸入${draft.reasonLabel ?? "更正原因"}。`;
  } else if (hasReason && trimmedReason.length > maxReason) {
    error = `${draft.reasonLabel ?? "更正原因"}不可超過 ${maxReason} 字。`;
  }

  const changed =
    trimmedContent !== draft.content
    || (hasTitle && trimmedTitle !== draft.title)
    || (hasReason && trimmedReason !== draft.reason);

  const valid = error === null;
  const locked = disabled || busy;

  function submit() {
    if (locked || !valid || !changed) return;
    void onSave({
      content: trimmedContent,
      ...(hasTitle ? { title: trimmedTitle } : {}),
      ...(hasReason ? { reason: trimmedReason } : {}),
    });
  }

  return (
    <View testID={`agent-proposal-editor-${proposalId}`} style={styles.root}>
      {hasTitle ? (
        <AppTextField
          label={draft.titleLabel ?? "標題"}
          accessibilityLabel={draft.titleLabel ?? "標題"}
          value={title}
          onChangeText={setTitle}
          maxLength={maxTitle}
          disabled={locked}
          editable={!locked}
        />
      ) : null}
      <AppTextField
        label={draft.contentLabel}
        accessibilityLabel={draft.contentLabel}
        value={content}
        onChangeText={setContent}
        multiline
        maxLength={draft.maxContentLength}
        disabled={locked}
        editable={!locked}
      />
      {hasReason ? (
        <AppTextField
          label={draft.reasonLabel ?? "更正原因"}
          accessibilityLabel={draft.reasonLabel ?? "更正原因"}
          value={reason}
          onChangeText={setReason}
          multiline
          maxLength={maxReason}
          disabled={locked}
          editable={!locked}
        />
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <AppButton
          label="保存草稿修改"
          accessibilityLabel="保存草稿修改"
          disabled={locked || !valid || !changed}
          loading={busy}
          onPress={submit}
          style={styles.button}
        />
        <AppButton
          label="取消編輯"
          accessibilityLabel="取消編輯草稿"
          variant="quiet"
          disabled={busy}
          onPress={onCancel}
          style={styles.button}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.small,
    backgroundColor: colors.quietSurface,
    minWidth: 0,
  },
  error: {
    fontFamily: chineseFont,
    color: colors.errorInk,
    ...readingType.meta,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    minWidth: 0,
  },
  button: {
    flexGrow: 1,
    flexBasis: 120,
    minWidth: 0,
    maxWidth: "100%",
  },
});
