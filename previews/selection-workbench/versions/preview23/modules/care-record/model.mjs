export const kinds=[['all','全部種類'],['note','日常觀察'],['feeding','飲食'],['sleep','睡眠'],['diaper','如廁／尿片'],['temperature','體溫'],['measurement','身高／體重'],['appointment','預約']];
export const kindLabel=k=>kinds.find(([key])=>key===k)?.[1]??k;
export const contextKey=s=>JSON.stringify([s.lifetime,s.scope.scopeKey,s.scope.childId,s.scope.access,s.list.activeQuery,s.list.activeKind,s.list.page]);
export const occupied=s=>['saving','unknown'].includes(s.policy.operation)||s.policy.draft||s.policy.deletion;
export const listBusy=s=>Boolean(s.pending.list);
export const canRead=s=>!s.disposed&&s.scope.access!=='lost'&&s.scope.online&&!occupied(s);
export function readNotice(s){const l=s.list;if(s.scope.access==='lost')return '目前無法存取這個孩子的記錄。';if(!s.scope.online)return l.hasSnapshot?'目前離線，顯示未核對的舊快照。':'目前離線，未能核對記錄。';if(l.code==='cursor_stale')return '搜尋窗口已失效，請重新搜尋，不能沿舊窗口繼續。';if(l.state==='loading')return l.hasSnapshot?'正在更新，舊快照可閱讀；暫不可開啟記錄。':'正在讀取已保存記錄…';if(l.state==='error'||l.state==='stale')return l.hasSnapshot?'未能重新核對，保留舊快照。':'未能核對記錄，請重新讀取。';if(!l.hasSnapshot)return '尚未讀取已保存記錄。';if(!l.records.length){if(l.hasMore)return '本頁尚無匹配，後面仍有搜尋窗口。';return l.activeQuery||l.activeKind!=='all'?'本搜尋窗口沒有符合已套用條件的記錄。':'本搜尋窗口暫未有已保存記錄。';}return `本頁已讀 ${l.records.length} 筆；不是全部家庭記錄。`;}
export const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value};
