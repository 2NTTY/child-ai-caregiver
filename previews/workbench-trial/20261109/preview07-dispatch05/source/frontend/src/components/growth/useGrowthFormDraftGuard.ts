import { useEffect, useRef, useState } from "react";
import type { GrowthActions, GrowthViewModel } from "../../growth-view-model";
import { usePreviewLeaveGuard } from "../../preview/PreviewNavigationGuard";

type Submission = { key: string; body: string; authorityVersion: string; revision: string };

/** Local form values are not retained by the domain owner until this exact payload is submitted. */
export function useGrowthFormDraftGuard(model: GrowthViewModel, actions: GrowthActions, key: string, dirty: boolean) {
  const revision = JSON.stringify([model.scopeKey, model.epoch, model.resetCounts[key] ?? 0]);
  const basis = useRef(revision), [submitted, setSubmitted] = useState<Submission | null>(null);
  const attempt = model.pending?.attempt;
  const retained = !!submitted && submitted.revision === revision && submitted.key === key && !!attempt
    && `${attempt.kind}:${attempt.id}` === key && attempt.body === submitted.body
    && (attempt.kind === "concern_create" ? attempt.authorityVersion : attempt.input.authorityVersion) === submitted.authorityVersion;
  const localDirty = model.access !== "lost" && dirty && basis.current === revision && !retained;
  usePreviewLeaveGuard(localDirty, false);
  const latest = useRef({ localDirty, actions, key }); latest.current = { localDirty, actions, key };
  useEffect(() => { basis.current = revision; setSubmitted(null); }, [revision]);
  useEffect(() => () => {
    const current = latest.current;
    // Navigation approval unmounts only this local draft; another original request stays intact.
    if (current.localDirty) current.actions.discardLocalDraft?.(current.key);
  }, []);
  return {
    edited() { basis.current = revision; setSubmitted(null); },
    submitted(input: unknown, authorityVersion: string) {
      setSubmitted({ key, body: JSON.stringify(input), authorityVersion, revision });
    },
  };
}
