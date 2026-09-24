export interface Child {
  id: string;
  workspaceId: string;
  displayName: string;
  createdAt: string;
  accessRole?: "owner" | "caregiver" | "viewer";
}

export interface TextRecord {
  id: string;
  childId: string;
  authorUserId: string;
  text: string;
  createdAt: string;
}

export interface RecordList {
  records: TextRecord[];
  limit: number;
}
