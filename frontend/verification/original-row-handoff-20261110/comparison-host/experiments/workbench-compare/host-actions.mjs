export const DISCARD_MESSAGE = '重新載入會丟棄左右兩側所有未儲存的本地合成內容與操作狀態。歷史版本沒有提供可核對的 clean／unknown 守衛，這不是保存或恢復成功的確認。確定丟棄兩側並開啟新對照？';
export function replaceComparison(hasLiveDocuments, confirmDiscard, replace) {
  if (hasLiveDocuments && confirmDiscard(DISCARD_MESSAGE) !== true) return false;
  replace(); return true;
}
export function visualOrder(swapped) { return Object.freeze({left:swapped?2:1,right:swapped?1:2}); }

// Availability is presentation scope, never a native clean/dirty receipt or navigation command.
export function routeAvailability(observation, actualRoute, supportedRoutes) {
  if (!observation?.sourceIdentityObserved || typeof actualRoute !== 'string' || observation.route !== actualRoute) return Object.freeze({available:false,reason:'unverified',route:actualRoute});
  let route;
  try { route=decodeURIComponent(new URL(actualRoute,'https://comparison.invalid').pathname).replace(/^\/+|\/+$/g,'').replace(/\.html$/,'')||'index'; } catch { return Object.freeze({available:false,reason:'unavailable',route:actualRoute}); }
  if (route.startsWith('(dashboard)/')) route=route.slice(12);
  return Object.freeze({available:supportedRoutes.includes(route),reason:supportedRoutes.includes(route)?'supported':'unavailable',route:actualRoute});
}
