import { useState } from 'react';
import type { Href } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { PreviewLink } from '../preview/PreviewNavigationGuard';
import { chineseFont, colors, readingType, spacing } from '../theme';

export function RouteTextLink({ href, label, accessibilityLabel = label }: { href: Href; label: string; accessibilityLabel?: string }) {
  const [active,setActive]=useState(false);
  return <PreviewLink href={href}><Pressable accessibilityRole="link" accessibilityLabel={accessibilityLabel}
    onHoverIn={()=>setActive(true)} onHoverOut={()=>setActive(false)} onPressIn={()=>setActive(true)} onPressOut={()=>setActive(false)}
    style={StyleSheet.flatten([styles.link,active&&styles.active])}><Text style={styles.label}>{label}</Text></Pressable></PreviewLink>;
}
const styles=StyleSheet.create({link:{minHeight:44,paddingVertical:spacing.sm,justifyContent:'center',alignSelf:'flex-start',maxWidth:'100%'},active:{backgroundColor:colors.paleTeal},label:{fontFamily:chineseFont,...readingType.tool,color:colors.deepTeal,fontWeight:'600',textDecorationLine:'underline',flexShrink:1}});
