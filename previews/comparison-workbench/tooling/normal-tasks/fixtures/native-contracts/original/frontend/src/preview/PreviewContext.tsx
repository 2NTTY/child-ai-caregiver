// Compatibility for presentation consumers. Production has one owner and no fixture provider.
export { ProductionProvider as PreviewProvider, useProduction as usePreview } from "../production/ProductionProvider";
