import {createElement as h} from 'react';
import {Stack} from 'expo-router';
import Head from 'expo-router/head';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {MotionProvider} from '../motion';
import {MotionPaperProvider} from '../motion/MotionPaperProvider';
import {PreviewNavigationGuard} from '../preview/PreviewNavigationGuard';
import {TasksOwnerProvider} from './TasksOwner.mjs';
import {HostBridge} from './HostPorts.mjs';
import {brand} from '../branding';
import {TasksCompositionProvider} from './TasksComposition.mjs';
export const sourceCssZoom='html { zoom: 1.4; }\n@media (width < 900px) {\n  html { zoom: 1.2; }\n}';
export default function RootLayout({mode='operation',children}){
 const stopPick=event=>{if(mode==='pick'){event.preventDefault();event.stopPropagation();}};
 const content=h(PreviewNavigationGuard,null,h(TasksOwnerProvider,{mode},h(HostBridge,null,
  h(TasksCompositionProvider,null,children??h(Stack,{screenOptions:{headerShown:false,animation:'none'}})))));
 const boundary=h('div',{'data-workbench-mode':mode,inert:mode==='pick',style:{display:'flex',flexDirection:'column',flex:1,minWidth:0,minHeight:0},
  onClickCapture:stopPick,onKeyDownCapture:stopPick,onInputCapture:stopPick,onChangeCapture:stopPick,onPointerDownCapture:stopPick},content);
 return h(SafeAreaProvider,null,h(MotionProvider,null,h(MotionPaperProvider,null,
  h(Head,null,h('title',null,brand.name),h('style',{id:'app-default-scale'},sourceCssZoom)),boundary)));
}
