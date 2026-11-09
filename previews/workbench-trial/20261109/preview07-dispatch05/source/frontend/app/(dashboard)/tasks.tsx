import { TasksAttemptBoundary } from "../../src/preview/tasks-interactive-qa/MountedLifecycleWitness";
/** DERIVED source-view leaf: retain the native Tasks screen and observe its real providers. */
import TasksPage from "../../src/screens/tasksScreen";
import { SyntheticPreviewSourceProbe } from "../../src/preview/SyntheticPreviewSourceProbe";
import { TasksChoiceHostPreview } from "../../src/preview/tasks-choice-host/TasksChoiceHostControl";

import { SyntheticTasksAcceptanceTools } from "../../src/preview/tasks-interactive-qa/SyntheticTasksAcceptanceTools";

export default function NormalTasksSourceRoute() {
  return <><SyntheticPreviewSourceProbe /><TasksChoiceHostPreview><TasksAttemptBoundary renderPage={()=> <TasksPage />}/><SyntheticTasksAcceptanceTools /></TasksChoiceHostPreview></>;
}
