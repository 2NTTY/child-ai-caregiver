import type { Href } from "expo-router";
import type { HomeDestination } from "./view-model.ts";
import { productionDestinations } from "./production/routes.ts";

export type HomeTarget =
  | { destination: "tasks"; taskId?: string }
  | { destination: "growth"; concernId?: string }
  | { destination: Exclude<HomeDestination, "tasks" | "growth"> };

/** Navigation data only. Owners still decide whether a target can be read or acted on. */
export function homeTargetHref(target: HomeDestination | HomeTarget): Href {
  if (typeof target === "string") return productionDestinations[target] as Href;
  if (target.destination === "tasks" && target.taskId) return { pathname: "/tasks", params: { taskId: target.taskId } };
  if (target.destination === "growth" && target.concernId) return { pathname: "/growth", params: { concernId: target.concernId } };
  return productionDestinations[target.destination] as Href;
}
