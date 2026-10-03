import { brand } from "../../branding";
import { useId, useState, type ReactNode } from "react";
import { Image, View } from "react-native";
import { Portal, Text } from "react-native-paper";
import type { PhotosActions, PhotosViewModel } from "../../photo-view-model";
import { photoExtractionLabels } from "../../photo-view-model";
import { colors, mobileLayout } from "../../theme";
import { AppDialog, AppDialog as Dialog } from "../AppDialog";
import { AppCheckbox } from "../AppCheckbox";
import { AppIcon } from "../AppIcon";
import { PageFrame } from "../PageFrame";
import { FormFieldMessage } from "../FormErrorSummary";
import { ReadStateNotice } from "../ReadStateNotice";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { AppButton, AppTextField, SectionCard, SectionHeader } from "../ui";
import { PhotoFilePicker, type PhotoFilePickerProps } from "./PhotoFilePicker";
import { PhotoRecordForm } from "./PhotoRecordForm";
import { photoStyles as s } from "./photo-styles";

const operationLabels: Record<PhotosViewModel["operation"]["state"], string> = { none: "", saving: "處理中 · 尚未確認", saved: "已確認（合成預覽）", failed: "失敗 · 原輸入保留", unknown: "結果未知 · 先查核", unconfirmed: "查核尚無確認結果", conflict: "版本衝突 · 尚未保存", confirmed_unavailable: "原操作已確認 · 結果不可讀" };
export function PhotosView({ model, actions, onCare, previewControls, selectOriginal, capturePreferred, captureOriginal }: { model: PhotosViewModel; actions: PhotosActions; onCare: () => void; previewControls?: ReactNode; selectOriginal?: PhotoFilePickerProps["selectOriginal"]; capturePreferred?: boolean; captureOriginal?: PhotoFilePickerProps["captureOriginal"] }) {
  const [width, setWidth] = useState(0);
  const sourceId = useId();
  const split = width >= 780, compact = width < mobileLayout.breakpoint;
  const selected = model.selected;
  const image = model.original?.imageSource ?? selected?.imageSource;
  const editable = model.access === "editable" && (!selected || selected.visibility === "private" && selected.isUploader && selected.canManage && !selected.recordId);
  const candidate = selected?.extraction.candidate;
  const locked = model.busy || ["unknown", "unconfirmed", "confirmed_unavailable", "conflict"].includes(model.operation.state);
  const listReadState = model.load === "loading" ? "loading" : model.load === "error" ? "error" : !model.online ? "stale" : model.items.length ? "ready" : "empty";
  const readMessage = model.load === "loading" ? model.items.length ? "正在重新讀取照片；已載入清單及草稿保留。" : "正在讀取照片…" : model.load === "error" ? "讀取未確認。原照片及草稿保留，先手動重新讀取。" : !model.online ? "已載入清單可能不是最新；重連後先重新讀取。" : listReadState === "empty" ? "目前沒有可讀取的照片。選擇原照片後，可先私人保存。" : "";
  const extractionState = selected?.extraction.state;
  const extractionMessage = extractionState && extractionState !== "not_requested" && !(model.operation.phase === "extract" && model.operation.state !== "none") ? `照片提取：${photoExtractionLabels[extractionState]}。` : "";
  return <PageFrame density="compact" title="照片與記錄" description="先保存私人原照片，再核對內容。只有你明確確認，才與家庭共享照片及記錄。" eyebrow={`${brand.name} · 孩子資料`}>
    <StatusAnnouncement eventKey={`${model.operation.reference}:${model.operation.phase}:${model.operation.state}:${model.operation.message}`} message={model.operation.state === "none" ? "" : `${operationLabels[model.operation.state]}。${model.operation.message}`} urgent={model.operation.state === "failed"} />
    <StatusAnnouncement key={selected?.id ?? "no-selected-photo"} eventKey={extractionState ?? "not_requested"} message={extractionMessage} urgent={extractionState === "failed"} />
    <StatusAnnouncement eventKey={model.access} message={model.access === "lost" ? "已無權查看這個孩子。照片、原檔、候選及草稿已清除。" : ""} urgent={model.access === "lost"} />
    <StatusAnnouncement eventKey={model.sourceError} message={model.sourceError} urgent />
    <View style={s.context}><Text style={s.title}>{model.childName}的照片</Text><View style={s.row}><AppButton label="重新讀取照片" variant="secondary" disabled={!model.online || model.busy || model.access === "lost"} onPress={actions.refresh} /><AppButton label="返回記錄" accessibilityLabel="返回照顧記錄" variant="quiet" onPress={onCare} disabled={locked} /></View></View>
    <View style={s.steps}>{["選擇原照片", "私人保存", "核對草稿", "家庭共享"].map((label, index) => <View key={label} style={s.step}><Text style={s.stepNumber}>{index + 1}</Text><Text style={s.meta}>{label}</Text></View>)}</View>
    {!model.online ? <View style={s.notice}><Text style={s.warning}>目前離線，已選原照片及草稿保留。重連後先核對最新狀態，不會自動重送。</Text></View> : null}
    {model.notice ? <Text style={s.body}>{model.notice}</Text> : null}
    {model.operation.state !== "none" ? <View style={[s.status, model.operation.state === "failed" && s.statusError]} testID="photo-operation"><Text style={s.title}>{operationLabels[model.operation.state]}</Text><Text style={s.body}>{model.operation.message}</Text>
      {model.operation.reference ? <Text style={s.meta}>合成操作參考：{model.operation.reference}；不是 Server opId。</Text> : null}
      <View style={s.row}>{["unknown", "unconfirmed"].includes(model.operation.state) ? <AppButton label={model.operation.phase === "upload" || model.operation.phase === "extract" ? "查核同一照片附件" : "查核原照片操作"} disabled={!model.online || model.busy} onPress={actions.checkOriginal} /> : null}
        {model.operation.state === "unconfirmed" && model.operation.checked ? <AppButton label="重試原操作" accessibilityLabel="明確重試原內容及原操作" variant="secondary" disabled={!model.fresh} onPress={actions.retryOriginal} /> : null}
        {model.reservationUnidentified && model.operation.state === "confirmed_unavailable" ? <AppButton label="結束待查並核對清單" variant="secondary" onPress={actions.finishUnidentified} /> : null}
      </View>
      {model.operation.state === "conflict" ? <><Text style={s.meta}>本頁基準：版本 {selected?.version ?? "未確定"}；目前版本：{model.latest?.version ?? "尚待重新讀取"}。原文草稿不會被最新資料覆蓋。</Text>
        {model.latest ? <AppButton label="使用目前版本並保留草稿" disabled={!model.online} onPress={actions.useLatest} /> : null}</> : null}
    </View> : null}
    {model.access === "lost" ? <SectionCard><SectionHeader density="compact" title="已無權查看這個孩子" /><Text style={s.body}>照片、原檔、候選及草稿已清除。請改選有權存取的孩子或重新核對身份。</Text></SectionCard> :
      <View style={[s.columns, !split && s.single]} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
        <View style={[s.editor, !split && s.full]}>
          <SectionCard testID="photo-original"><SectionHeader density="compact" title={selected ? "原照片" : "選擇原照片"} icon="image-outline" action={selected || model.original ? <AppButton label="清除本頁" variant="quiet" disabled={locked} onPress={actions.clearEditor} /> : undefined} />
            {image ? <Image source={image} resizeMode="contain" accessibilityLabel="原照片預覽" style={[s.image, compact && s.mobileImage]} /> : <View style={s.placeholder}><AppIcon name="image-outline" size={24} color={colors.teal} /><Text style={s.meta}>保留照片原檔，確認後才共享</Text></View>}
            {model.original || selected ? <><Text style={s.title}>{model.original?.fileName ?? selected?.fileName}</Text><Text style={s.meta}>{((model.original?.bytes ?? selected?.bytes ?? 0) / (1024 * 1024)).toFixed(2)} MiB · {selected?.state === "ready" ? "原檔已模擬保存" : "本次原檔尚未完整保存"}</Text></> : null}
            {selected ? <View style={s.related}><Text style={s.body}>{selected.visibility === "private" ? "私人，只有上傳者可讀取" : "已確認家庭共享"}</Text><Text style={s.body}>提取：{photoExtractionLabels[selected.extraction.state]}。{selected.recordId ? "已連結確認記錄，不能再次提取或確認。" : ""}</Text>
              <Text style={s.meta}>來源：{selected.source}；上傳者：{selected.ownerLabel}；版本 {selected.version}</Text></View> : null}
            {model.capacityReached ? <Text style={s.warning}>已模擬達到新增容量限制。可核對現有附件，不能再新增照片。</Text> : null}
            {model.reservationUnidentified ? <Text style={s.warning}>已確認操作的附件結果未能識別。保留原檔，不會再次建立；請逐項核對清單或明確清除本頁。</Text> : null}
            {(!selected || selected.state === "reserved") && model.access === "editable" ? <>
              <PhotoFilePicker disabled={!model.canPick} onPick={actions.pickOriginal} onError={actions.reportFileError} selectOriginal={selectOriginal} capturePreferred={capturePreferred} captureOriginal={captureOriginal} />
              {!selected ? <View><AppTextField nativeID={sourceId} label="照片來源" accessibilityLabel="照片來源" value={model.source} disabled={model.formLocked} onChangeText={actions.editSource} error={!!model.sourceError} aria-invalid={!!model.sourceError} aria-describedby={`${sourceId}-message`} /><FormFieldMessage id={`${sourceId}-message`} error={model.sourceError || undefined} help="保留原文字；私人保存後沿用原來源。" /></View> : <Text style={s.meta}>待上傳附件只接受相同類型、大小及 SHA-256 的原檔；來源及附件識別保持原樣。</Text>}
              <AppButton label={selected ? "繼續上傳同一原檔" : "私人保存原照片"} disabled={!model.canUpload} onPress={actions.upload} />
            </> : null}
            {selected?.state === "ready" && editable ? <View style={s.related}><AppCheckbox label="我同意把原照片交由 Gemini 提取；候選仍需核對" checked={model.modelConsent} disabled={!model.canExtract} onChange={actions.setModelConsent} />
              <AppButton label={selected.extraction.state === "failed" ? "重新提取照片內容" : "提取照片內容"} variant="secondary" disabled={!model.canExtract || !model.modelConsent} onPress={actions.extract} /></View> : null}
            {candidate && editable ? <View style={s.candidate} testID="photo-candidate"><Text style={s.title}>提取候選 · 尚未確認</Text><Text style={s.original}>{candidate.text || "未提取到文字"}</Text><Text style={s.body}>數值：{candidate.rawValue || "未有"}；單位：{candidate.unit || "未有"}；時間：{candidate.timeRaw || "未知"}</Text>
              {candidate.uncertainties.map((item, index) => <Text key={index} style={s.warning}>• {item}</Text>)}
              <Text style={s.meta}>採用候選會取代本頁手動草稿。</Text><AppButton label="採用候選" accessibilityLabel="採用候選並取代本頁草稿" variant="secondary" disabled={model.formLocked} onPress={actions.adoptCandidate} /></View> : null}
            {selected?.canManage ? <AppButton label="刪除照片及連結記錄" variant="quiet" disabled={!model.canDelete} onPress={actions.openDeletion} /> : null}
          </SectionCard>
          {editable && (model.original || selected) ? <PhotoRecordForm key={model.formKey} model={model} actions={actions} /> : null}
        </View>
        <View style={[s.list, !split && s.full]}><SectionCard testID="photo-list"><SectionHeader density="compact" title="照片清單" subtitle="私人照片只有上傳者可見；共享照片按家庭權限讀取。" icon="image-outline" />
          {model.access === "read_only" ? <Text style={s.meta}>你目前可查看家庭共享照片及本人既有的私人照片；不能上傳、提取、確認或刪除。</Text> : null}
          <ReadStateNotice state={listReadState} message={readMessage} />
          {model.items.map(item => <View key={item.id} style={s.item}>
            <View style={s.itemHeader}><View style={s.itemIcon}><AppIcon name="image-outline" size={20} color={colors.teal} /></View><View style={s.itemCopy}><Text style={s.title}>{item.fileName}</Text><Text style={s.meta}>{item.createdAtLabel} · 版本 {item.version}</Text></View></View>
            <View style={s.row}><Text style={s.meta}>{item.visibility === "private" ? "私人" : "家庭共享"} · {item.state === "ready" ? "原檔已保存" : "原檔待上傳"}</Text></View>
            <AppButton label="開啟照片" accessibilityLabel={`開啟照片：${item.visibility === "private" ? "私人" : "共享"} · ${item.fileName}`} variant="quiet" disabled={locked || model.load !== "ready"} onPress={() => actions.openPhoto(item)} />
          </View>)}
          <Text style={s.meta}>JPEG／PNG，每張最多 4 MiB；每個孩子最多 100 張及 100 MiB。清單數量不是全部容量統計。</Text>
        </SectionCard></View>
      </View>}
    {previewControls}
    <Portal><AppDialog visible={!!model.replacement} onDismiss={actions.cancelReplacement}>
      <Dialog.Title>取代本頁原檔與草稿？</Dialog.Title><Dialog.Content><Text style={s.body}>這個動作會清除目前編輯器的原檔及未共享草稿。已保存的合成附件仍在清單；結果未知時不能用更換照片避開查核。</Text></Dialog.Content>
      <Dialog.Actions style={s.row}><AppButton label="保留目前草稿" variant="quiet" onPress={actions.cancelReplacement} /><AppButton label="確認取代本頁" onPress={actions.confirmReplacement} /></Dialog.Actions>
    </AppDialog>
      <AppDialog danger visible={model.deletion} onDismiss={actions.closeDeletion}>
        <Dialog.Title danger>刪除照片及連結記錄</Dialog.Title><Dialog.Content><View style={s.stack}><Text style={s.body}>{selected?.fileName} · 版本 {selected?.version}</Text>
          <Text style={s.body}>{selected?.recordId ? "這會移除原照片及已連結的家庭確認記錄，家庭成員將不能再讀取。" : "這會移除這份附件及原照片；它尚未連結家庭確認記錄。"}</Text>
          <AppCheckbox label="我已核對照片與連結記錄的刪除範圍" checked={model.deleteScope} disabled={locked} onChange={actions.setDeleteScope} />
          <AppCheckbox label="我確認要刪除這份照片及連結記錄" checked={model.deleteFinal} disabled={locked} onChange={actions.setDeleteFinal} />
          <Text style={s.meta}>刪除確認不等於實體檔案及備份即時清理完成。結果未知時先查核原操作。</Text>
          {model.operation.phase === "delete" && ["unknown", "unconfirmed"].includes(model.operation.state) ? <AppButton label="查核原照片刪除" disabled={!model.online || model.busy} onPress={actions.checkOriginal} /> : null}
        </View></Dialog.Content><Dialog.Actions style={s.row}><AppButton label="返回照片" variant="quiet" disabled={model.busy} onPress={actions.closeDeletion} /><AppButton label="確認刪除" accessibilityLabel="確認刪除照片" variant="danger" disabled={!model.canDelete || !model.deleteScope || !model.deleteFinal} onPress={actions.deletePhoto} /></Dialog.Actions>
      </AppDialog></Portal>
  </PageFrame>;
}
