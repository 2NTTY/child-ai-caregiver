import {NOTES} from './notes-data.mjs';
const ids = new Set(NOTES.map(note => note.id));
export function createState() {
  return Object.freeze({layout: 'A', activeId: NOTES[0].id});
}
export function transition(state, event) {
  if (!event || typeof event !== 'object') return state;
  if (event.type === 'LAYOUT' && (event.value === 'A' || event.value === 'B')) {
    return event.value === state.layout ? state : Object.freeze({...state, layout: event.value});
  }
  if (event.type === 'READ' && state.layout === 'A' && ids.has(event.id)) {
    return event.id === state.activeId ? state : Object.freeze({...state, activeId: event.id});
  }
  return state;
}
