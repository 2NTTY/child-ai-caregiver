import type { Concern } from "../src/shared/concerns.ts";

/** Keep whole events and expose incomplete history; the business store remains authoritative. */
export function concernAgentContext(item: Concern): Concern {
  const view: Concern = { ...item, attentionIds: item.attentionIds.slice(-20), events: [], historyComplete: false };
  for (const event of item.events.slice().reverse()) {
    const events = [event, ...view.events];
    if (JSON.stringify({ ...view, events }).length > 6000) break;
    view.events = events;
  }
  view.historyComplete = item.historyComplete && view.events.length === item.events.length && view.attentionIds.length === item.attentionIds.length;
  return view;
}
