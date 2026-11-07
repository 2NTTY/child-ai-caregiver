export const initialState = () => ({currentStep:0,variant:'A',guideStatus:'first_login',intent:null});
export function transition(state, event) {
 if (!event || typeof event !== 'object') return state;
 if(event.type==='variant') return ['A','B'].includes(event.value)?{...state,variant:event.value}:state;
 if(event.type==='status') return ['first_login','incomplete','not_required','unknown'].includes(event.value)?{...state,guideStatus:event.value}:state;
 if(event.type==='intent') return event.destination===['chat','care','settings'][state.currentStep]?{...state,intent:event.destination}:state;
 if(event.type==='return') return {...state,intent:null};
 let index=state.currentStep;
 if(event.type==='select') { if(!Number.isInteger(event.index)||event.index<0||event.index>2) return state; index=event.index; }
 else if(event.type==='previous') index=Math.max(0,index-1);
 else if(event.type==='next') index=Math.min(2,index+1);
 else return state;
 return {...state,currentStep:index,intent:null};
}
