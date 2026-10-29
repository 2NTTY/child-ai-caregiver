// Metro supplies this literal context module to Expo's client entry and static renderer.
declare module "expo-router/_ctx" {
  export const ctx: Parameters<typeof import("expo-router").ExpoRoot>[0]["context"];
}
