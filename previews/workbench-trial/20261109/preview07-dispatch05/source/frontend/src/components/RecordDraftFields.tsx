import { useId } from "react";
import { StyleSheet, View } from "react-native";
import { Controller, type Control } from "react-hook-form";
import type { PhotoDraftFields } from "../photo-view-model";
import { careKindOptions } from "../care-view-model";
import { spacing } from "../theme";
import { AppCheckbox } from "./AppCheckbox";
import { FormFieldMessage } from "./FormErrorSummary";
import { AppSelect, AppTextField } from "./ui";

export const recordDraftFieldOrder = ["kind", "text", "rawValue", "unit", "timeRaw"] as const;
export const recordDraftFieldLabels = { kind: "記錄種類", text: "記錄原文", rawValue: "數值原文", unit: "數值單位", timeRaw: "事件時間原文" } as const;

// The photo and source record forms share fields; their confirmation scopes remain separate.
export function RecordDraftFields({ control, locked, prefix, showDetails = true, onFieldChange }: {
  control: Control<PhotoDraftFields>; locked: boolean; prefix: "照片" | "來源"; showDetails?: boolean;
  onFieldChange: <K extends keyof PhotoDraftFields>(name: K, value: PhotoDraftFields[K]) => void;
}) {
  const formId = useId();
  const fieldId = (name: keyof PhotoDraftFields) => `${formId}-${name}`;
  function textField(name: "text" | "rawValue" | "unit" | "timeRaw", label: string, help?: string) {
    return <Controller name={name} control={control} render={({ field, fieldState }) => <View>
      <AppTextField ref={field.ref} nativeID={fieldId(name)} label={label} accessibilityLabel={label} value={field.value} multiline={name === "text"} disabled={locked} error={!!fieldState.error}
        aria-invalid={!!fieldState.error} aria-describedby={fieldState.error?.message || help ? `${fieldId(name)}-message` : undefined}
        onBlur={field.onBlur} onChangeText={value => { field.onChange(value); onFieldChange(name, value); }} />
      <FormFieldMessage id={`${fieldId(name)}-message`} error={fieldState.error?.message} help={help} />
    </View>} />;
  }
  return <>
    {showDetails ? <Controller name="kind" control={control} render={({ field, fieldState }) => <View>
      <AppSelect ref={field.ref} id={fieldId("kind")} label={`${prefix}記錄種類`} value={field.value} options={careKindOptions} disabled={locked} onBlur={field.onBlur}
        invalid={!!fieldState.error} describedBy={fieldState.error?.message ? `${fieldId("kind")}-message` : undefined}
        onChange={value => { field.onChange(value); onFieldChange("kind", value); }} />
      <FormFieldMessage id={`${fieldId("kind")}-message`} error={fieldState.error?.message} />
    </View>} /> : null}
    {textField("text", `${prefix}記錄原文`, "最多 5,000 字。保留原文字，不自動補寫事實。")}
    {showDetails ? <>
      <View style={styles.quantities}><View style={styles.quantity}>{textField("rawValue", `${prefix}數值原文`)}</View><View style={styles.quantity}>{textField("unit", `${prefix}數值單位`)}</View></View>
      <Controller name="approximate" control={control} render={({ field }) => <AppCheckbox label="內容含約數或約略時間" checked={field.value} disabled={locked} onChange={value => { field.onChange(value); onFieldChange("approximate", value); }} />} />
      {textField("timeRaw", `${prefix}事件時間原文`, "保留原時間說法。日期未確定時，不會推算成精準時間。")}
    </> : null}
  </>;
}
const styles = StyleSheet.create({ quantities: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md }, quantity: { flex: 1, minWidth: 110 } });
