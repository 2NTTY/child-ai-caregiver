import type { ReactNode } from "react";
import { ProductionCareProfileDomains } from "./CareProfileDomains";
import { ProductionTaskKnowledgeDomains } from "./TaskKnowledgeDomains";
import { ProductionPhotoInputDomains } from "./PhotoInputDomains";
import { ProductionSettingsDomains } from "./SettingsDomains";

/** Exactly one owner per domain, shared by pages, home and the Agent's manual fallbacks. */
export function ProductionDomains({ children }: { children: ReactNode }) {
  return <ProductionCareProfileDomains><ProductionTaskKnowledgeDomains><ProductionPhotoInputDomains><ProductionSettingsDomains>
    {children}
  </ProductionSettingsDomains></ProductionPhotoInputDomains></ProductionTaskKnowledgeDomains></ProductionCareProfileDomains>;
}
