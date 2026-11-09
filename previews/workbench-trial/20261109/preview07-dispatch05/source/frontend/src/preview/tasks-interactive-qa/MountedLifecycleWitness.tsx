import { createContext, type ReactNode } from 'react';
import type { CallbackRegistration, RequestLabel } from './callback-witness';
/** Native stays inert. No suspension, subscriptions, callback registration or admission. */
export const MountedRequestContext=createContext<RequestLabel|null>(null);
export function CallbackCommitWitness(_props:CallbackRegistration) { return null; }
export function MountedLifecycleWitness({children}:{children:ReactNode}) { return <>{children}</>; }
export function TasksAttemptBoundary({renderPage}:{renderPage:()=>ReactNode}) { return <>{renderPage()}</>; }
