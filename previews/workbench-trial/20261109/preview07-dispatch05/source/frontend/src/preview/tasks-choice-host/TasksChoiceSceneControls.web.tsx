import { useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TasksChoiceSceneContext } from './TasksChoiceSceneContext';
/** Only presentation is portalled; its Control and product owners remain in place. */
export function TasksChoiceSceneControls({ children }: { children: ReactNode }) {
  const scene = useContext(TasksChoiceSceneContext), host = scene?.read().controlsHost;
  return host ? createPortal(children, host, 'tasks-choice-scene-controls') : null;
}
