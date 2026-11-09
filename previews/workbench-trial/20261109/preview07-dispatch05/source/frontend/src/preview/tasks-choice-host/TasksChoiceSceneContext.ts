import { createContext } from 'react';
import type { TasksChoiceSceneObserver } from './scene-barrier';
export const TasksChoiceSceneContext = createContext<TasksChoiceSceneObserver | null>(null);
