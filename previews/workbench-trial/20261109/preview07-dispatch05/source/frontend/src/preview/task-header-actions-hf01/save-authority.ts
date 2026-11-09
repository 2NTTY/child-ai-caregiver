import { allowsHeaderEvent, type HeaderEvent, type HeaderSession } from "./selection.ts";

/** Transient only. Never serialize this frame or its event into a recipe. */
export type HeaderSaveAuthority = Readonly<{frame: object; event: HeaderEvent}>;
export function captureHeaderSaveAuthority(frame: object, session: HeaderSession): HeaderSaveAuthority | null {
  if (!session.current || session.generation === null) return null;
  // Called after an authorized transition constructs its resulting frame. The
  // new recipe revision/generation may not have committed yet; this is only a
  // stamp, not permission to write. The actual write must pass the gate below.
  const event: HeaderEvent = Object.freeze({epoch:session.epoch,
    authorityToken:session.current.authorityToken, generation:session.generation,
    mode:session.mode, variantId:session.current.variantId, revision:session.current.revision});
  return Object.freeze({frame,event});
}
export function canCommitHeaderSave(authority: HeaderSaveAuthority | null, currentFrame: object,
  committedSession: HeaderSession | null): boolean {
  return authority !== null && authority.frame === currentFrame && committedSession !== null
    && allowsHeaderEvent(committedSession, authority.event, "recipe");
}
