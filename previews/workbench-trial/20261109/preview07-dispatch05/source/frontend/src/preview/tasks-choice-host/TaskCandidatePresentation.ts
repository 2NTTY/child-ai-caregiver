import { Component, createContext, createElement, use, type ReactNode } from 'react';
import { createCandidateReceipt, type CandidateReceipt } from './candidate-receipt.ts';

const Context=createContext<CandidateReceipt|null>(null);
type Props={scopeKey:string|null;children:ReactNode};
type State={receipt:CandidateReceipt};

/** Candidate metadata only, above the replaceable Expo root in ProductionOwnerHost. */
export class TaskCandidatePresentationProvider extends Component<Props,State> {
  state:State={receipt:createCandidateReceipt(this.props.scopeKey)};
  static getDerivedStateFromProps(props:Props,state:State):State|null {
    // A single current instance, not a token-indexed cache: committed A -> B -> A
    // is fresh. Allocation is inert; discarded renders cannot claim/write the
    // committed receipt. No navigation key or cleanup clears retained metadata.
    return state.receipt.scopeKey===props.scopeKey?null:{receipt:createCandidateReceipt(props.scopeKey)};
  }
  render() { return createElement(Context.Provider,{value:this.state.receipt},this.props.children); }
}

// No local fallback: the diagnostic and consumer must see the actual host receipt.
export function useTaskCandidatePresentation() { return use(Context); }
