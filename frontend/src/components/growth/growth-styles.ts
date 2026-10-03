import { StyleSheet } from "react-native";
import { chineseFont,colors,radius,spacing,typeScale , readingType } from "../../theme";
export const growthStyles=StyleSheet.create({
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
