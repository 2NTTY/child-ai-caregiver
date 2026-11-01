import {createElement as h} from 'react';import {Text,View} from 'react-native';
export default function Unavailable(){return h(View,{accessibilityRole:'alert'},h(Text,null,'這個頁面尚未接入比較預覽。沒有讀取、傳送或保存資料。'));}
