export type FirstScreenImage = "home-hero" | "login-hero";
export type ImageOutcome = "loaded" | "fallback";
export type ImageOutcomes = Partial<Record<FirstScreenImage, ImageOutcome>>;

// This is a failure budget for decorative artwork, never a successful load.
export const firstScreenImageFallbackMs = 15_000;

export function requiredFirstScreenImages(pathname: string, width: number): readonly FirstScreenImage[] {
  // Home artwork is decorative: it must not hold ready care data behind a splash.
  // The independent identity, permission and data-readiness gates still apply.
  if (pathname === "/login" && width >= 900) return ["login-hero"];
  return [];
}

export function settleFirstScreenImage(outcomes: ImageOutcomes, image: FirstScreenImage, outcome: ImageOutcome): ImageOutcomes {
  // Once a failed image has been replaced, a late load must not pop it back in.
  return outcomes[image] ? outcomes : { ...outcomes, [image]: outcome };
}

export function firstScreenImagesSettled(required: readonly FirstScreenImage[], outcomes: ImageOutcomes) {
  return required.every(image => outcomes[image] !== undefined);
}
