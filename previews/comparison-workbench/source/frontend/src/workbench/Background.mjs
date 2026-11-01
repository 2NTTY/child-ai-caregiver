/** Fixed owned decoration only. No device storage, picker or persisted presentation state. */
import {createContext,createElement as h,useContext} from 'react';
/** @type {import('react-native').ImageSourcePropType} */
export const defaultHomeBackground=require('../../assets/images/harbour-family-hero.png');
/** @type {import('react').Context<import('./Background.types').BackgroundContextValue|null>} */
const Context=createContext(null);
const unavailable=async()=>{throw Error('BACKGROUND_SELECTION_UNAVAILABLE');};
/** @type {import('./Background.types').BackgroundContextValue} */
const value={source:defaultHomeBackground,selected:null,busy:false,notice:'此預覽只使用預設背景。',select:unavailable,restore:unavailable,imageFailed:()=>{}};
/** @param {{children?: import('react').ReactNode; scope?: string|null}} props */
export function BackgroundProvider({children}){return h(Context.Provider,{value},children);}
export function useBackground(){const background=useContext(Context);if(!background)throw Error('BACKGROUND_PROVIDER_REQUIRED');return background;}
