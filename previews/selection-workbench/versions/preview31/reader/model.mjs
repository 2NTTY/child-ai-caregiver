function selection(catalog, state) {
  const document = catalog.find(item => item.id === state.documentId) ?? null;
  const version = document?.versions.find(item => item.id === state.versionId) ?? null;
  const chapters = version?.status === 'ready' ? version.chapters : [];
  return {document, version, chapters, chapter: chapters.find(item => item.id === state.chapterId) ?? null};
}
export function initialState(catalog) {
  const document = catalog[0], version = document?.versions[0];
  return {documentId: document?.id ?? null, versionId: version?.id ?? null,
    chapterId: version?.status === 'ready' ? version.chapters[0]?.id ?? null : null,
    query: '', layout: 'library', bookmark: null};
}
export function transition(state, action, catalog) {
  const {document, version, chapters, chapter} = selection(catalog, state);
  switch (action.type) {
    case 'document': {
      const next = catalog.find(item => item.id === action.value);
      if (!next || next.id === state.documentId) return state;
      const version = next.versions[0];
      return {...state, documentId: next.id, versionId: version?.id ?? null,
        chapterId: version?.status === 'ready' ? version.chapters[0]?.id ?? null : null};
    }
    case 'version': {
      const next = document?.versions.find(item => item.id === action.value);
      if (!next || next.id === version?.id) return state;
      const available = next.status === 'ready' ? next.chapters : [];
      return {...state, versionId: next.id, chapterId: available.some(item => item.id === state.chapterId) ? state.chapterId : available[0]?.id ?? null};
    }
    case 'chapter': return chapters.some(item => item.id === action.value) ? {...state, chapterId: action.value} : state;
    case 'query': return typeof action.value === 'string' ? {...state, query: action.value.slice(0,160)} : state;
    case 'layout': return ['library','desk'].includes(action.value) ? {...state, layout: action.value} : state;
    case 'bookmark': return chapter ? {...state, bookmark: {documentId:state.documentId,versionId:state.versionId,chapterId:chapter.id}} : state;
    case 'return-bookmark': {
      if (!state.bookmark || !selection(catalog,state.bookmark).chapter) return state;
      return {...state,...state.bookmark};
    }
    case 'clear-bookmark': return {...state,bookmark:null};
    default: return state;
  }
}
export function projectReader(catalog, state) {
  const current = selection(catalog, state), query = state.query.trim(), needle = query.toLocaleLowerCase();
  const results = query ? current.chapters.filter(chapter => [chapter.title,...chapter.paragraphs].some(text => text.toLocaleLowerCase().includes(needle))).map(chapter => ({id:chapter.id,title:chapter.title,
    excerpt: chapter.paragraphs.find(text=>text.toLocaleLowerCase().includes(needle)) ?? chapter.paragraphs[0] ?? ''})) : [];
  return {...current, available: current.version?.status === 'ready', query, results, searchActive: !!query};
}
export function sourceDetails(catalog, state, sourceId) {
  const {version, chapters} = selection(catalog,state);
  if (!chapters.some(chapter=>chapter.sourceIds.includes(sourceId))) return null;
  return version.sources.find(source=>source.id===sourceId) ?? {id:sourceId,title:'來源未提供',status:'missing',text:null};
}
