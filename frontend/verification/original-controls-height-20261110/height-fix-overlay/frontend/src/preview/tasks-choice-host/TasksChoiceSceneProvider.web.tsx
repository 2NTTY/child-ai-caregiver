import { recordSceneLifecycle } from '../tasks-interactive-qa/trace';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { TasksChoiceSceneContext } from './TasksChoiceSceneContext';
import { createTasksChoiceSceneObserver, type TasksChoiceSceneObserver } from './scene-barrier';
import { createTasksChoiceSceneDOM } from './scene-dom';
import { sceneReleaseAllows } from './scene-admission';

/** Permanent siblings: opting in never moves/remounts the product React subtree. */
export function TasksChoiceSceneProvider({ children }: { children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null), product = useRef<HTMLDivElement>(null), controls = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<TasksChoiceSceneObserver | null>(null);
  useLayoutEffect(() => {
    const containerRoot = container.current, productRoot = product.current, controlsHost = controls.current;
    if (!containerRoot || !productRoot || !controlsHost) return;
    let next: TasksChoiceSceneObserver | null = null;
    const dom = createTasksChoiceSceneDOM({ container: containerRoot, productRoot, controlsHost,
      onInvalidate: reason => next?.revoke(reason), onReadinessChange: () => next?.refreshDOM(), requestExit: () => { next?.requestExit(); } });
    // Every committed setup, including StrictMode replay, gets a fresh lifetime.
    next = createTasksChoiceSceneObserver({ dom, admission: () => sceneReleaseAllows(productRoot) }); setScene(next);
    recordSceneLifecycle('scene-setup',next,containerRoot,productRoot,controlsHost);
    return () => {
      recordSceneLifecycle('scene-cleanup-begin',next,containerRoot,productRoot,controlsHost);
      next?.retire(); dom.retire();
      recordSceneLifecycle('scene-cleanup-end',next,containerRoot,productRoot,controlsHost);
    };
  }, []);
  return <TasksChoiceSceneContext.Provider value={scene}>
    <div ref={container} data-tasks-choice-scene-root="" style={{ display:'flex',flexDirection:'column',flex:1,height:'100%',minHeight:0,minWidth:0,overflowY:'auto',overflowX:'hidden' }}>
      <div ref={controls} data-tasks-choice-controls-host="" tabIndex={-1} aria-label="待辦候選配方控制區"
        style={{ display:'flex',flexDirection:'column',flexShrink:0,maxHeight:'min(360px,45%)',minHeight:0,minWidth:0,overflow:'hidden' }}/>
      <div ref={product} data-tasks-choice-product-root="" style={{ display:'flex',flexDirection:'column',flex:1,minHeight:320,minWidth:0 }}>
        {children}
      </div>
    </div>
  </TasksChoiceSceneContext.Provider>;
}
