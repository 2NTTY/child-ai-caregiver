import type { TextStyle, ViewStyle } from 'react-native';
import type { AppButtonAppearance } from '../../components/ui';
import type { EmptyListAppearance } from '../../components/EmptyListCard';
import type { ReadNoticeAppearance } from '../../components/ReadStateNotice';
import type { AppStatusBadgeAppearance } from '../../components/AppStatusBadge';
import { getHFTasksPresentation, type HFTasksPresentation } from '../tasks-hf-full-presentation/presentation';
import { careStyles, careButtonAppearance, careButtonSourceContract, careReadIndicatorAppearance } from '../tasks-care-presentation/styles';
import { careColors } from '../tasks-care-presentation/source-theme';
import { handbookStyles, handbookActionAppearance } from '../tasks-handbook-presentation/styles';
import { handbookColors, handbookWebFont, handbookReadingType } from '../tasks-handbook-presentation/source-theme';

/** Source-local missing regions only, never a provider, owner or admission. */
export type ModuleSourceVariant = 'harbour' | 'fourth' | 'handbook' | 'care';
interface ListStyles {
  scheduleList: ViewStyle; timeGroup: ViewStyle; groupHeading: ViewStyle; groupTitle: TextStyle; meta: TextStyle;
  pagination: ViewStyle; loadMore: ViewStyle; emptyCard: ViewStyle;
}
export interface SourceRegionAppearance {
  readonly header?: HFTasksPresentation['header'];
  readonly list: Readonly<ListStyles>;
  readonly empty: EmptyListAppearance;
  readonly read: ReadNoticeAppearance;
  readonly row?: Readonly<Record<string, ViewStyle & TextStyle>>;
  readonly badge?: AppStatusBadgeAppearance;
  readonly iconColor?: string; readonly warningIconColor?: string;
}
function freeze<T>(owned: T): T {
  if (!owned || typeof owned !== 'object') return owned;
  const copy = Array.isArray(owned) ? owned.map(freeze) : Object.fromEntries(Object.entries(owned).map(([key,value]) => [key,freeze(value)]));
  return Object.freeze(copy) as T;
}

// Exact Fourth theme, ordinary-row and badge source expressions; provenance is pinned.
const fourthColors = {
  // Distinct semantic roles: dark reading ink, teal actions, restrained warm emphasis.
  ink: "#183E45",
  teal: "#0C6E72",
  deepTeal: "#07585D",
  paper: "#FFFFFE",
  white: "#FFFFFE",
  canvas: "#F3F8F7",
  sage: "#D9ECE7",
  paleTeal: "#E8F4F0",
  accent: "#EBC356",
  onAccent: "#183E45",
  amber: "#92721F",
  paleAmber: "#FFF7E0",
  warningInk: "#715416",
  coral: "#B52D3A",
  paleCoral: "#FFF2F1",
  errorInk: "#B52D3A",
  muted: "#52656B",
  line: "#C8D9D7",
  softLine: "#DFE9E6",
  controlOutline: "#718B8C",
  controlSurface: "#FFFFFE",
  neutralSurface: "#F3F8F7",
  sidebar: "#EAF3F0",
  selectedNav: "#D9ECE7",
  quietSurface: "#F1F7F4",
  mintSurface: "#E8F4F0",
  previewSurface: "#F3F8F7",
  pressedOverlay: "rgba(24, 62, 69, 0.08)",
  accentPressed: "#DBB247",
  inkPressed: "#07585D",
  selectedPressed: "#C6DFD7",
  warningPressed: "#F5EBCB",
  darkActionRipple: "rgba(0, 0, 0, 0.12)",
  statusWarm: "#FFF7E0",
  statusUnknown: "#FFF7E0",
  statusWarmLine: "#92721F",
  statusUnknownLine: "#92721F",
  statusFailedLine: "#B52D3A",
  overlay: "rgba(24, 62, 69, 0.28)",
} as const;
const fourthTones = {
  neutral: { background: fourthColors.neutralSurface, border: fourthColors.line, ink: fourthColors.muted, icon: "radiobox-blank" },
  info: { background: fourthColors.paleTeal, border: fourthColors.sage, ink: fourthColors.ink, icon: "information-outline" },
  success: { background: "#E5F4EB", border: "#82B59A", ink: "#216E4E", icon: "check-circle" },
  warning: { background: fourthColors.paleAmber, border: fourthColors.statusWarmLine, ink: fourthColors.warningInk, icon: "clock-outline" },
  error: { background: fourthColors.paleCoral, border: fourthColors.coral, ink: fourthColors.errorInk, icon: "close" },
} as const;
function fourthRow(fontFamily: string | undefined) { return {
  row: { flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1, borderBottomColor: fourthColors.softLine, borderLeftWidth: 3, borderLeftColor: "transparent", paddingHorizontal: 8, paddingVertical: 16, minHeight: 80, minWidth: 0 },
  historyRow: { alignItems: "flex-start", paddingVertical: 12, minHeight: 48 },
  summary: { fontFamily: fontFamily, color: fourthColors.ink, fontSize: 16, lineHeight: 24 },
  leading: { alignSelf: "flex-start", paddingTop: 2 }, copy: { flex: 1, minWidth: 0, gap: 4 },
  metadata: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 8, rowGap: 4, minWidth: 0 },
  title: { fontFamily: fontFamily, color: fourthColors.ink, fontSize: 16, lineHeight: 24, fontWeight: "700" },
  time: { fontFamily: fontFamily, color: fourthColors.ink, fontSize: 13, lineHeight: 20, fontVariant: ["tabular-nums"], flexShrink: 1 },
  assignee: { fontFamily: fontFamily, color: fourthColors.muted, fontSize: 13, lineHeight: 20, flexShrink: 1 },
  warning: { fontFamily: fontFamily, color: fourthColors.warningInk, fontSize: 13, lineHeight: 20 }, review: { borderLeftColor: fourthColors.statusWarmLine },
  selected: { borderLeftColor: fourthColors.teal },
  highlight: { backgroundColor: fourthColors.paleTeal, borderRadius: 10 }, focused: { borderLeftColor: fourthColors.teal }, pressed: { backgroundColor: fourthColors.paleTeal }, selectedPressed: { backgroundColor: fourthColors.selectedNav },
} satisfies Record<string, ViewStyle & TextStyle>; }

export function getSourceRegionAppearance(source: unknown, compact: boolean, platform: 'web' | 'native'): SourceRegionAppearance | undefined {
  const hf = getHFTasksPresentation(source, {compact, platform});
  if (hf) {
    const e = hf.dateList.empty, r = hf.dateList.read;
    const es = e.styles as Record<string, ViewStyle & TextStyle>;
    const empty: EmptyListAppearance = {
      structure: source === 'harbour' ? 'icon-tile-copy-action-rail' : 'inline-title',
      card: es.card, heading: es.heading, copy: es.copy, actions: es.actions,
      title: es.title, detail: es.detail,
      icon: {size:e.icon.size,color:e.icon.color,style:es.icon},
    };
    const fontFamily = platform === 'web' ? "'Noto Sans TC', 'Microsoft JhengHei', 'PingFang TC', sans-serif" : undefined;
    return freeze({header:hf.header, list:hf.dateList.styles, empty,
      read:{...r.styles,loadingColor:r.loading.color,nonLoadingIcon:r.nonLoadingIcon,empty},
      ...(source === 'fourth' ? {row:fourthRow(fontFamily),iconColor:fourthColors.muted,warningIconColor:fourthColors.warningInk,
        badge:{style:{alignSelf:'flex-start',maxWidth:'100%',minWidth:0,flexDirection:'row',alignItems:'center',gap:4,paddingHorizontal:8,paddingVertical:3,borderWidth:1,borderRadius:10},
          labelStyle:{fontFamily,fontSize:13,lineHeight:20,fontWeight:'700',flexShrink:1},tones:fourthTones}} : {}),
    } as SourceRegionAppearance);
  }
  if (source === 'care') {
    const s=careStyles;
    const empty: EmptyListAppearance={structure:'inline-title',card:s.emptyCard,heading:s.emptyHeading,title:s.emptyTitle,detail:s.emptyDetail,icon:null};
    return freeze({list:{scheduleList:s.scheduleList,timeGroup:s.timeGroup,groupHeading:s.groupHeading,groupTitle:s.groupTitle,meta:s.meta,pagination:s.pagination,loadMore:s.loadMore,emptyCard:{}},empty,
      read:{notice:s.readNotice,error:s.readError,copy:s.readCopy,title:s.readTitle,body:s.readBody,staticIndicator:careReadIndicatorAppearance.staticStyle,loadingColor:careReadIndicatorAppearance.color,nonLoadingIcon:null,empty}});
  }
  if (source !== 'handbook') return undefined;
  // Historical Handbook EmptyListCard, ReadStateNotice and TasksView footer;
  // existing accepted heading/group/row vocabulary is reused, not reconstructed.
  const fontFamily=platform==='web'?handbookWebFont:undefined,c=handbookColors;
  const empty: EmptyListAppearance={structure:'inline-title',
    card:{minWidth:0,alignSelf:'stretch',gap:8,padding:16,backgroundColor:c.neutralSurface,borderColor:c.softLine,borderWidth:1,borderRadius:12},
    heading:{flexDirection:'row',alignItems:'flex-start',gap:8},
    title:{flex:1,minWidth:0,fontFamily,color:c.ink,fontSize:16,lineHeight:26,fontWeight:'600'},
    detail:{fontFamily,color:c.muted,...handbookReadingType.tool},icon:{size:22,color:c.muted}};
  return freeze({list:{scheduleList:handbookStyles.scheduleList,timeGroup:handbookStyles.timeGroup,groupHeading:handbookStyles.groupHeading,groupTitle:handbookStyles.groupTitle,
    meta:handbookStyles.meta,pagination:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:8,paddingTop:8},loadMore:{gap:8,alignItems:'flex-start'},emptyCard:{minHeight:176,padding:24,justifyContent:'center'}},empty,
    read:{notice:{flexDirection:'row',alignItems:'flex-start',gap:8,paddingVertical:8},error:{borderLeftWidth:2,borderLeftColor:c.errorInk,paddingLeft:12},copy:{flex:1,minWidth:0,gap:8},
      title:{fontFamily,color:c.ink,...handbookReadingType.tool,fontWeight:'700'},body:{fontFamily,color:c.muted,...handbookReadingType.tool},
      staticIndicator:{width:16,height:16,marginTop:2,borderRadius:8,borderWidth:2,borderColor:c.teal},loadingColor:c.teal,nonLoadingIcon:null,empty}});
}

/** Pure mapping to the unchanged control owner; no callback/ref in the descriptor. */
export function taskSourceButtonAppearance(source: ModuleSourceVariant, variant: 'primary'|'secondary'|'quiet', density: 'standard'|'compact'='standard', platform: 'web'|'native'='web'): AppButtonAppearance {
  if (source==='care') return {...careButtonAppearance(variant,density),focusStyle:careButtonSourceContract.focusStyle};
  if (source==='handbook') {
    const base=variant==='primary'?handbookActionAppearance.primary:handbookActionAppearance.secondary;
    return {...base,mode:variant==='primary'?'contained':variant==='quiet'?'text':'outlined',
      style:variant==='quiet'?[handbookStyles.button,{alignSelf:'flex-start'}]:base.style,
      contentStyle:[handbookStyles.buttonContent,density==='compact'&&{minHeight:40}],
      disabledStyle:variant==='quiet'?{backgroundColor:'transparent'}:base.disabledStyle,
      hoverStyle:variant==='primary'?undefined:handbookStyles.buttonHovered};
  }
  const hf=getHFTasksPresentation(source,{compact:false,platform})!, b=hf.dateList.buttonAppearance,s=b.styles;
  const h=source==='harbour',ink=h?'#233A35':fourthColors.ink,teal=h?'#245C50':fourthColors.teal,white=h?'#FFFFFF':fourthColors.white;
  const filled=variant==='primary';
  return {control:'paper-button',mode:filled?'contained':'outlined',buttonColor:filled?teal:'transparent',textColor:filled?white:ink,
    rippleColor:filled?'rgba(0, 0, 0, 0.12)':undefined,theme:b.theme,
    style:[s.button,!filled&&s.outlineButton,variant==='quiet'&&s.quietButton],
    contentStyle:[s.buttonContent,density==='compact'&&s.compactButtonContent],labelStyle:s.buttonLabel,compactLabelStyle:b.compactLabel,
    touchContentStyle:s.mobileTarget,disabledStyle:filled?{backgroundColor:b.theme.colors.surfaceDisabled}:s.disabledOutlineButton,
    disclosure:{style:[s.button,{alignSelf:'flex-start',flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,paddingHorizontal:12,paddingVertical:8,borderWidth:1,borderColor:h?'#7D9087':fourthColors.controlOutline,backgroundColor:'transparent'}],
      contentStyle:[s.buttonContent,density==='compact'&&s.compactButtonContent],labelStyle:[s.buttonLabel,{color:ink,lineHeight:22,flexShrink:1}],touchStyle:s.mobileTarget,
      disabledStyle:s.disabledOutlineButton,disabledLabelStyle:s.disabledLabel,focusStyle:s.focusedButton,pressedStyle:s.buttonPressed,iconColor:ink,disabledIconColor:b.theme.colors.onSurfaceDisabled}};
}
