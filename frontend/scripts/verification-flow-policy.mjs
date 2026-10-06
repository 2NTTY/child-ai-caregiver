// Availability of the historical browser runner, not product completion or browser acceptance.
export const legacyFlowReasons = Object.freeze({
  care: "The original /care record-search/form flow was replaced by review and history readers.",
  tasks: "The original task-row labels and form-first layout were replaced by the dated task workspace.",
  memory: "The memory page is read-only; the old flow edits facts and topics that are no longer exposed.",
  growth: "The old stage-card forms were replaced by concern timelines and the living report.",
  "growth-text": "The old enlarged-text flow targets the archived stage-card form.",
  summary: "The old summary route now opens child overview/preparations; original operations remain in explicit legacy recovery.",
  "summary-text": "The old text-size flow targets the prior summary/form composition."
});

export const availableFlowNames = Object.freeze([
  "layout", "profile", "family", "shell", "settings", "shared", "login", "deletion", "design", "channels",
  "agent", "agent-flow", "mobile-density", "photos", "model-settings", "model-settings-text", "sources",
  "sources-text", "contact", "contact-text", "emergency-help", "composer-surfaces", "camera", "appearance",
  "toolbar-safety"
]);

export const currentLayoutRoutes = Object.freeze([
  "/", "/care", "/photos", "/sources", "/growth", "/summary", "/contact", "/profile", "/family", "/memory",
  "/tasks", "/settings", "/chat", "/guide", "/login", "/history", "/more"
]);

export function rejectLegacyFlow(name) {
  const reason = legacyFlowReasons[name];
  if (!reason) throw new Error("Unknown legacy flow: " + name);
  throw new Error("Browser flow '" + name + "' is unsupported pending migration. " + reason
    + " The original source is preserved under frontend/_archive/fe-w38-replaced-ui. This is a coverage gap, not a product regression or a passed check.");
}

export function resolveVerificationSelection(args) {
  if (args.length === 0) {
    throw new Error("The default legacy browser aggregate is unsupported pending migration for: "
      + Object.keys(legacyFlowReasons).join(", ")
      + ". Select explicit available runners, for example: npm run verify:web -- layout. Available runners: "
      + availableFlowNames.join(", ")
      + ". Availability is not validation; each selected runner must pass its actual assertions. No checks were run.");
  }
  const selected = new Set(args);
  for (const name of selected) {
    if (Object.hasOwn(legacyFlowReasons, name)) rejectLegacyFlow(name);
    if (!availableFlowNames.includes(name)) throw new Error("Unknown browser flow '" + name + "'. No checks were run.");
  }
  return selected;
}

