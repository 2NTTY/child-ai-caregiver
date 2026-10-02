// Display projections only. Formal source payloads remain owned by the existing APIs.
export interface ChatCitationView {
  id: string; title: string; section: string; publisher: string; excerpt: string;
  classification: "official_guidance" | "recent_information" | "synthetic";
  versionId: string; versionHash: string; checkedAt: string; fetchedAt: string;
  lastSuccessfulCheckAt: string | null; sourceDate: string | null; validUntil: string | null;
  applicabilityLabel: string; internalOnly: boolean; url: string | null;
}
