import type { PersonalModelCatalogEntry, PersonalModelProvider } from '../src/shared/model-settings.ts';

// Suggestions and known capability hints, never an eligibility gate.
const models = [
  ['gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite'],
  ['gemini-3.8-flash', 'Gemini 3.8 Flash'],
  ['gemini-2.5-flash', 'Gemini 2.5 Flash'],
  ['gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite'],
  ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
] as const;

// Keep Express suggestions conservative; callers can still specify another model ID.
const expressModels = new Set(['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro']);
export function personalModelEntry(id: string, provider: PersonalModelProvider, availability: PersonalModelCatalogEntry['availability'] = 'not_checked'): PersonalModelCatalogEntry {
  const profile = models.find(([model]) => model === id);
  return { id, label: profile?.[1] ?? id.slice(0, 100), provider, availability,
    capabilities: { tools: Boolean(profile), image: Boolean(profile), audio: Boolean(profile), textStreaming: Boolean(profile) } };
}
export function personalModelCatalog(provider: PersonalModelProvider): PersonalModelCatalogEntry[] {
  if (provider === 'openai-compatible') return [];
  return models.filter(([id]) => provider !== 'vertex' || expressModels.has(id)).map(([id]) => personalModelEntry(id, provider));
}
