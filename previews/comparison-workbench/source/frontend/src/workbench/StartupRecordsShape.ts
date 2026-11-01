/** Type-only seven-field input consumed by the original startup helper.
 * No RecordsController, API, user/auth owner or data is constructed here. */
export interface RecordsState {
 auth:'checking'|'signedOut'|'signedIn'|'unavailable';
 online:boolean; children:{id:string}[]; childrenLoading:boolean;
 childrenError:string|null; childrenLoadedAt:string|null; selectedChildId:string|null;
}
