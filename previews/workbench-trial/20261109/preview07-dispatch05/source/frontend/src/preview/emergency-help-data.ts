import type {EmergencyHelpData} from '../components/agent/EmergencyHelpView';
// Exact display snapshot from GitHub ce87370 src/shared/emergency-help.ts; production passes that constant.
export const emergencyHelpSnapshot: EmergencyHelpData = {
  checkedOn: '2026-09-28',
  text: '如有呼吸停頓、不省人事等危及生命的情況，請立即尋求當地緊急醫療服務。在香港可致電 999，說明所在位置及傷病者情況，並依接線員指示。毋須等候 Agent 回覆。',
  sources: [
    {title: '香港消防處：先遣急救員計劃', url: 'https://www.hkfsd.gov.hk/chi/fire_ambulance_services/responder.html'},
    {title: '香港消防處：召喚救護服務', url: 'https://www.hkfsd.gov.hk/chi/fire_ambulance_services/fire_information.html'},
  ],
};
