import type { PersonalModelCatalogEntry, PersonalModelProvider } from '../src/shared/model-settings.ts';

// Profiles describe the adapter's supported protocol, not availability for a particular key.
const models = [
  ['gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite'],
  ['gemini-3.8-flash', 'Gemini 3.8 Flash'],
  ['gemini-2.5-flash', 'Gemini 2.5 Flash'],
  ['gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite'],
  ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
] as const;

// Express mode has a smaller published model list than the Developer API.
const expressModels = new Set(['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro']);
export function personalModelSupported(model: string, provider: PersonalModelProvider = 'gemini'): boolean {
  return models.some(([id]) => id === model) && (provider !== 'vertex' || expressModels.has(model));
}
export function personalModelCatalog(provider: PersonalModelProvider): PersonalModelCatalogEntry[] {
  return models.filter(([id]) => personalModelSupported(id, provider)).map(([id, label]) => ({ id, label, provider, availability: 'not_checked',
    capabilities: { tools: true, image: true, audio: true, textStreaming: true } }));
}
