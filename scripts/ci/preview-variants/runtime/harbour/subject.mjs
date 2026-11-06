import {pathToFileURL} from 'node:url';
const runtime=await import(pathToFileURL(process.env.RUNTIME_UNDER_TEST));
export const createRuntime=runtime.createSyntheticPreviewRuntime;
export const usingNewRuntime=true;
