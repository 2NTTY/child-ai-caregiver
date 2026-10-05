import { StyleSheet } from "react-native";
import { chineseFont,colors,radius,spacing,typeScale, workspaceType, readingType } from "../../theme";
export const growthStyles=StyleSheet.create({
  toolbar:{gap:spacing.md,borderBottomWidth:1,borderBottomColor:colors.line,paddingBottom:spacing.lg},
  hidden:{display:"none"},indexAside:{width:220,minWidth:0,gap:spacing.lg},concernIndex:{gap:spacing.sm},
  concernRow:{padding:spacing.md,gap:spacing.xs,minHeight:64,borderBottomWidth:1,borderBottomColor:colors.softLine},concernSelected:{backgroundColor:colors.paleTeal,borderLeftWidth:3,borderLeftColor:colors.ink},pressed:{opacity:0.65},
  eyebrow:{fontFamily:chineseFont,...readingType.meta,color:colors.muted,fontWeight:"700"},concernTitle:{fontFamily:chineseFont,...workspaceType.title,color:colors.ink},concernHeading:{gap:spacing.sm,paddingBottom:spacing.md},
  reading:{fontFamily:chineseFont,...readingType.body,color:colors.ink},timelinePanel:{backgroundColor:colors.paper,padding:spacing.lg,gap:spacing.lg,minWidth:0},
  timeline:{paddingLeft:spacing.sm},timelineEvent:{borderLeftWidth:2,borderLeftColor:colors.line,paddingLeft:spacing.lg,paddingBottom:spacing.xl,gap:spacing.sm},timelineDot:{position:"absolute",left:-6,top:3,width:10,height:10,borderRadius:5,backgroundColor:colors.ink},timelinePending:{backgroundColor:colors.amber},confirmedRow:{gap:spacing.xs,paddingVertical:spacing.sm},
  stack:{gap:spacing.md},smallStack:{gap:spacing.sm},row:{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:spacing.sm},
  columns:{flexDirection:"row",alignItems:"flex-start",gap:spacing.lg},main:{flex:2,minWidth:0,gap:spacing.lg},aside:{flex:1,minWidth:0,gap:spacing.lg},full:{width:"100%",gap:spacing.lg},
  title:{fontFamily:chineseFont,fontSize:typeScale.body,fontWeight:"700",lineHeight:25,color:colors.ink},
  body:{fontFamily:chineseFont,...readingType.tool,color:colors.ink,flexShrink:1},
  meta:{fontFamily:chineseFont,...readingType.meta,color:colors.muted,flexShrink:1},
  warning:{fontFamily:chineseFont,...readingType.tool,color:colors.warningInk},
  error:{fontFamily:chineseFont,...readingType.meta,color:colors.errorInk},
  box:{borderWidth:1,borderColor:colors.line,borderRadius:radius.medium,padding:spacing.md,gap:spacing.sm},
  divider:{borderTopWidth:1,borderColor:colors.line,paddingTop:spacing.md,gap:spacing.sm},
});
