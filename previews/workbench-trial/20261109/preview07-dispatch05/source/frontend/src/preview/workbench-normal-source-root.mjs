/** Native Metro runtime precedes this module at the two exact derived entry sites. */
import { captureNormalSourceRoot } from './workbench-normal-source-control.mjs';
import AppRegistry from 'expo/src/launch/AppRegistry';
captureNormalSourceRoot(AppRegistry);
