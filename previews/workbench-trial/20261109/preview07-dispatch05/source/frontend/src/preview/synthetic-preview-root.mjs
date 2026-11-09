/** Capture the genuine native root after Metro initialization. */
import { captureSyntheticPreviewRoot } from './synthetic-preview-runtime.mjs';
import AppRegistry from 'expo/src/launch/AppRegistry';
captureSyntheticPreviewRoot(AppRegistry);
