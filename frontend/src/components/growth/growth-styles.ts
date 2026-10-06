import { StyleSheet } from "react-native";
import { chineseFont,colors,radius,spacing,typeScale, workspaceType, readingType } from "../../theme";
const timelineDotTop = 3;
const timelineDotSize = 10;
export const growthStyles=StyleSheet.create({
  headerTools:{minWidth:0,maxWidth:"100%",gap:spacing.xs},
  headerActions:{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:spacing.sm,minWidth:0},
  headerRefreshButton:{width:148,maxWidth:"100%"},
  headerStatus:{minHeight:18},
  workspace:{width:"100%",minWidth:0,gap:spacing.md},
  indexAside:{width:200,minWidth:0,gap:spacing.lg,borderRightWidth:1,borderRightColor:colors.line,paddingRight:spacing.lg},concernIndex:{gap:spacing.sm},
  concernRow:{backgroundColor:colors.controlSurface,borderWidth:1,borderColor:colors.line,borderRadius:radius.small,padding:spacing.md,gap:spacing.xs,minHeight:64,borderBottomWidth:1,borderBottomColor:colors.softLine},concernSelected:{backgroundColor:colors.paleTeal,borderLeftWidth:3,borderLeftColor:colors.ink},pressed:{backgroundColor:colors.paleTeal},selectedPressed:{backgroundColor:colors.selectedNav},
  eyebrow:{fontFamily:chineseFont,...readingType.meta,color:colors.muted,fontWeight:"700"},concernTitle:{fontFamily:chineseFont,...workspaceType.title,color:colors.ink},concernHeading:{gap:spacing.sm,paddingBottom:spacing.md},
  reading:{fontFamily:chineseFont,...readingType.body,color:colors.ink},timelinePanel:{paddingVertical:spacing.sm,gap:spacing.lg,minWidth:0},
  timeline:{paddingLeft:spacing.sm},timelineEvent:{paddingLeft:spacing.lg+2,paddingBottom:spacing.xl,gap:spacing.sm},
  timelineLine:{position:"absolute",left:0,width:2,backgroundColor:colors.line,zIndex:0},
  timelineLineBefore:{top:0,height:timelineDotTop},timelineLineAfter:{top:timelineDotTop+timelineDotSize,bottom:0},
  timelineDot:{position:"absolute",left:1-timelineDotSize/2,top:timelineDotTop,width:timelineDotSize,height:timelineDotSize,borderRadius:timelineDotSize/2,backgroundColor:colors.ink,zIndex:1},
  timelinePending:{backgroundColor:colors.amber},confirmedRow:{gap:spacing.xs,paddingVertical:spacing.sm},
  stack:{gap:spacing.md},smallStack:{gap:spacing.sm},row:{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:spacing.sm},
  columns:{flexDirection:"row",alignItems:"flex-start",gap:spacing.lg},main:{flex:2,minWidth:0,gap:spacing.lg},full:{width:"100%",gap:spacing.lg},
  title:{fontFamily:chineseFont,fontSize:typeScale.body,fontWeight:"700",lineHeight:25,color:colors.ink},
  body:{fontFamily:chineseFont,...readingType.tool,color:colors.ink,flexShrink:1},
  meta:{fontFamily:chineseFont,...readingType.meta,color:colors.muted,flexShrink:1},
  warning:{fontFamily:chineseFont,...readingType.tool,color:colors.warningInk},
  box:{borderWidth:1,borderColor:colors.line,borderRadius:radius.medium,padding:spacing.md,gap:spacing.sm},
  divider:{borderTopWidth:1,borderColor:colors.line,paddingTop:spacing.md,gap:spacing.sm},
  archiveSources:{borderLeftWidth:2,borderLeftColor:colors.line,paddingLeft:spacing.lg,paddingVertical:spacing.sm,gap:spacing.lg},
  archiveUnverified:{fontFamily:chineseFont,...readingType.body,color:colors.warningInk},
  archiveUpdate:{borderLeftWidth:3,borderLeftColor:colors.warningInk,paddingLeft:spacing.md,gap:spacing.xs},
  archiveEmpty:{paddingVertical:spacing.xl,gap:spacing.md,minWidth:0},
  compactActions:{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:spacing.sm},
});
