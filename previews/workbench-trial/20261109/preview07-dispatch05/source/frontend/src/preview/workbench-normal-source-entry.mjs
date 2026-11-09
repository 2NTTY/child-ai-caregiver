/** Test-only prelude: dependency graph deliberately contains no SDK/application imports. */
import { installNormalSourceEntry } from './workbench-normal-source-control.mjs';
installNormalSourceEntry(globalThis, {variant: "harbour", case: 'normal'});
