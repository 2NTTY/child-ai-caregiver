import { z } from 'zod';
import type { FirestoreChatStore } from './firestore-chat.ts';
import type { FirestoreNativePush } from './firestore-native-push.ts';
import type { createFirestoreAuthority } from './firestore-authority.ts';
import { domainParse, domainReject } from './firestore-domain-data.ts';

const command = z.object({opId:z.uuid()}).strict();
export function createProactiveDemo(env: Record<string,string|undefined>, authority: ReturnType<typeof createFirestoreAuthority>,
  chat: FirestoreChatStore, push: Pick<FirestoreNativePush,'readChatDeliveryStatuses'>) {
  const user = env.YUBAN_DEMO_USER_ID, child = env.YUBAN_DEMO_CHILD_ID;
  const enabled = !!user && user.length <= 128 && z.uuid().safeParse(child).success;
  async function get(opId: string) {
    if (!enabled || !user || !child) domainReject('demo_not_configured',409);
    return authority.runTransaction(user,child,async b => {
      const saved = await chat.getContact(b,'demo',opId);
      if (!saved) domainReject('not_found',404);
      return {opId, messageId:saved.messageId,text:saved.text,deliveries:await push.readChatDeliveryStatuses(b,saved.deliveryIds)};
    });
  }
  return { enabled,get,async publish(input:unknown) {
    if (!enabled || !user || !child) domainReject('demo_not_configured',409);
    const {opId} = domainParse(command,input);
    await authority.runTransaction(user,child,b => chat.contactParent(b,{opId,origin:'demo',
      text:'這是育有方的主動通知示範。你可以在這則訊息下繼續聊天。'}));
    return get(opId);
  } };
}
