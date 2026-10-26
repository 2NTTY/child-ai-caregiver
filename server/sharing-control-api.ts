import { z } from 'zod';
import { sharingCommandSchema } from '../src/shared/sharing-control.ts';
import type { createFirestoreSharingStore } from './firestore-sharing.ts';
import { apiError, jsonResponse } from './workspace-api.ts';

export type SharingControl = Pick<ReturnType<typeof createFirestoreSharingStore>, 'spacesPage' | 'spaceView' | 'membersPage'
  | 'sharesPage' | 'invitationsPage' | 'executeCommand' | 'controlOperation' | 'childView'>;

export async function handleSharingControlRequest(request: Request, userId: string, store: SharingControl,
  isCurrentUser: (userId: string) => Promise<boolean>, readJson: (request: Request) => Promise<unknown>): Promise<Response> {
  const expected = request.headers.get('x-expected-user-id');
  if (expected !== userId) return apiError(expected ? 'identity_changed' : 'account_precondition_required', '請重新登入後再試。', expected ? 409 : 428);
  const url = new URL(request.url), path = url.pathname.slice('/api/shared-spaces'.length);
  try {
    if ([...url.searchParams.keys()].some(key => key !== 'cursor') || url.searchParams.getAll('cursor').length > 1)
      return apiError('invalid_input', '請重新讀取資料。', 400);
    const cursor = url.searchParams.get('cursor') ?? undefined;
    if (cursor !== undefined) z.string().min(1).max(8192).parse(cursor);
    let value: unknown;
    if (request.method === 'GET' && path === '') value = await store.spacesPage(userId, cursor);
    else if (request.method === 'POST' && path === '/commands' && !cursor) {
      const input = sharingCommandSchema.parse(await readJson(request));
      if (!await isCurrentUser(userId)) return apiError('identity_changed', '登入身份已改變。', 409);
      value = await store.executeCommand(userId, input);
    } else if (request.method === 'GET' && /^\/operations\/[^/]+$/u.test(path) && !cursor) {
      value = { operation:await store.controlOperation(userId, z.uuid().parse(path.split('/')[2])) };
    } else if (request.method === 'GET' && /^\/[^/]+\/children\/[^/]+$/u.test(path) && !cursor) {
      const parts = path.split('/');
      value = await store.childView(userId, z.uuid().parse(parts[1]), z.uuid().parse(parts[3]));
    } else {
      const match = /^\/([^/]+)(?:\/(members|shares|invitations))?$/u.exec(path);
      if (!match || request.method !== 'GET' || !match[2] && cursor) return apiError('not_found', '找不到資料。', 404);
      const spaceId = z.uuid().parse(match[1]);
      value = match[2] === 'members' ? await store.membersPage(userId, spaceId, cursor)
        : match[2] === 'shares' ? await store.sharesPage(userId, spaceId, cursor)
        : match[2] === 'invitations' ? await store.invitationsPage(userId, spaceId, cursor) : await store.spaceView(userId, spaceId);
    }
    if (!await isCurrentUser(userId)) return apiError('identity_changed', '登入身份已改變。', 409);
    return jsonResponse(value);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError('invalid_input', '請檢查內容及版本。', 400);
    throw error;
  }
}
