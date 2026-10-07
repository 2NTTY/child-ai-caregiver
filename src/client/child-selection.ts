/** Navigation hint only. Never contains child data, drafts or permissions. */
export interface ChildSelection { childId: string; workspaceId: string }
export interface ChildSelectionPreferences {
  read(userId: string): ChildSelection | null;
  write(userId: string, selection: ChildSelection): void;
  clear(userId: string): void;
}
