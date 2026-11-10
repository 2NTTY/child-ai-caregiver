type Slot='header-actions'|'filters'|'date-list'|'calendar-layout';
export const CANDIDATE_SLOTS:readonly Slot[];
export function decodeTaskCandidateFragment(hash:unknown):{status:'none'|'invalid'}|{status:'valid';slots:Record<Slot,[string,string]|null>};
export function encodeTaskCandidateFragment(slots:unknown):string|null;
