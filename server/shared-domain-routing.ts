import { z } from 'zod';
import { domainReject } from './firestore-domain-data.ts';

/** Only domains with shared transaction and disclosure support may accept this selector. */
export function sharedDomainRoute(path: string) {
  const match = /^\/api\/children\/([0-9a-f-]{36})\/(records|care(?:\/[0-9a-f-]{36}\/(?:revise|delete))?|profile(?:\/delete)?|tasks(?:\/[0-9a-f-]{36}\/change)?|memory\/(?:facts(?:\/confirmed|\/[0-9a-f-]{36}\/(?:confirm|revise|deactivate|delete))?|topics(?:\/[0-9a-f-]{36}\/(?:change|reopen|delete))?))$/iu.exec(path);
  if (!match || !z.uuid().safeParse(match[1]).success) domainReject('shared_domain_unavailable', 409);
  return { childId: match[1].toLowerCase(), module: match[2].startsWith('profile') ? 'profile' as const
    : match[2].startsWith('tasks') ? 'tasks' as const : match[2].startsWith('memory/') ? 'memory' as const : 'care' as const };
}
