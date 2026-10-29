/** A presentation request checked by the existing owner before and after its read. */
export type OwnerReadRouteRequest = { isCurrent: () => boolean; onAccepted: (selectedId?: string | null) => void; onRejected?: (acceptedId: string | null) => void };
