import type { HomeDestination } from "../view-model";

// Enable each domain only after its production owner has been integrated.
export const connectedProductionRoutes = ["/", "/login", "/guide", "/chat"] as const;
export function isProductionRouteConnected(pathname: string): boolean {
  return (connectedProductionRoutes as readonly string[]).includes(pathname);
}
export const productionDestinations: Record<HomeDestination, string> = {
  chat: "/chat", care: "/care", profile: "/profile", family: "/family", memory: "/memory", settings: "/settings",
  guide: "/guide", tasks: "/tasks", photos: "/photos", sources: "/sources", growth: "/growth", summary: "/summary", contact: "/contact",
};
