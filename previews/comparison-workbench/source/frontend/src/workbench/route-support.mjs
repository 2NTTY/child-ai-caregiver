/** Route membership only; not an executable-page/runtime capability claim. */
export function isProductionRouteConnected(path){return path==='/tasks';}
export function routeSupport(path){return isProductionRouteConnected(path)?{status:'available'}:{status:'unavailable',reason:'ROUTE_NOT_IMPLEMENTED'};}
