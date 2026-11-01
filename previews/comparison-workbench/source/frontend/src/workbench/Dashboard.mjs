import {createElement as h} from 'react';import {Slot} from 'expo-router';
import {AppShell} from '../components/AppShell';import {AppBackdrop} from '../components/appearance/AppBackdrop';
import {BackgroundProvider} from './Background.mjs';
export default function Dashboard({children}){return h(BackgroundProvider,null,h(AppBackdrop,null,h(AppShell,null,children??h(Slot))));}
