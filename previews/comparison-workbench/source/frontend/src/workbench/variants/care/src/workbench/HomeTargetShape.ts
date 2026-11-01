export type HomeDestination = "chat" | "care" | "profile" | "family" | "memory" | "settings" | "guide" | "tasks" | "photos" | "sources" | "growth" | "summary" | "contact";
export type HomeTarget =
  | { destination: "tasks"; taskId?: string }
  | { destination: "growth"; concernId?: string }
  | { destination: Exclude<HomeDestination, "tasks" | "growth"> };
