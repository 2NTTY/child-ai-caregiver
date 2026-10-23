import type { PickBackgroundImage } from "../background-view-model";
// Web uses the file-input component; other non-native hosts must not pretend to have a picker.
export const pickBackgroundImage: PickBackgroundImage = async () => { throw new Error("System image picker unavailable"); };
