import type { IncomingSharePackageTarget } from '../incoming-share.ts';
import type { ProductionOwner } from './ProductionOwner.ts';

/** Explicit package intake uses the account import owner, independently of the chat draft. */
export function createProductionPackageShareTarget(owner: ProductionOwner): IncomingSharePackageTarget | null {
  const importer = owner.handoverImportOwner, { identityKey, scopeKey } = owner.getSnapshot(), state = importer.getSnapshot();
  const current = () => {
    const next = owner.getSnapshot(), imported = importer.getSnapshot();
    return !!identityKey && next.identityKey === identityKey && next.scopeKey === scopeKey
      && next.account.gate === 'ready' && !next.account.busy && next.account.deletion.phase === 'idle'
      && imported.identityKey === identityKey && imported.userId === next.records.user?.id && imported.online;
  };
  if (!current() || state.pending || state.upload || state.busy) return null;
  return { current,
    async choose(pick, signal) {
      let accepted = false;
      await importer.choose(async ownerSignal => {
        if (!current() || signal.aborted) return null;
        const file = await pick(ownerSignal);
        if (!file) return null;
        if (!current() || signal.aborted) { file.release(); return null; }
        accepted = true;
        return file;
      }, signal);
      const after = importer.getSnapshot(), adopted = accepted && !!(after.pending || after.upload);
      if (adopted && current() && !signal.aborted) importer.requestPanel();
      return adopted;
    },
  };
}
