import {projectReader} from './model.mjs';
// A disabled control cannot receive the focus released by clearing a bookmark.
export function clearBookmarkFocusTarget(state, catalog) {
  return projectReader(catalog,state).chapter ? 'set-bookmark' : 'version-select';
}
