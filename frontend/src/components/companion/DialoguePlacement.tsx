import { createContext, useContext, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

export const DialoguePlacement = createContext({ leftOfFace: false, seam: 0, sideRoom: 220, cheekBottom: 0, entryTop: 0, room: 0 });

export function DialogueSlot({ speech = false, chooser = false, children }: { speech?: boolean; chooser?: boolean; children: ReactNode }) {
  const { leftOfFace, seam, sideRoom, cheekBottom, entryTop, room } = useContext(DialoguePlacement);
  const width = Math.min(sideRoom, chooser ? 290 : speech ? 248 : 214);
  const left = leftOfFace ? seam - width : seam;
  if (chooser) return <ScrollView keyboardShouldPersistTaps="handled" style={{ position: 'absolute', left, width,
    bottom: Math.max(4, cheekBottom - 70), maxHeight: Math.max(50, room - cheekBottom + 62), flexGrow: 0 }}>{children}</ScrollView>;
  return <View pointerEvents="box-none" style={{ position: 'absolute', left, width,
    ...(speech ? { bottom: cheekBottom, alignItems: leftOfFace ? 'flex-end' : 'flex-start' } as const : { top: entryTop }) }}>{children}</View>;
}
