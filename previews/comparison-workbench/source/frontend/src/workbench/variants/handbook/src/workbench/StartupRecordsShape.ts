/** Actual consumed seven-field projection, not the RecordsController API. */
export interface RecordsState {
 auth: "checking" | "signedOut" | "signedIn" | "unavailable";
 online: boolean;
 children: { id: string; }[];
 childrenLoading: boolean;
 childrenError: string | null;
 childrenLoadedAt: string | null;
 selectedChildId: string | null;
}
