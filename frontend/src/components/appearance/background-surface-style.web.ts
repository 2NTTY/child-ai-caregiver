import "./backgroundSurface.css";

export function backgroundSurfaceProps(frosted: boolean) {
  return { dataSet: { backgroundSurface: frosted ? "frosted" : "tint" } };
}
