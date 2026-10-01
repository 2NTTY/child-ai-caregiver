// Display-only selection port. Wallpaper is not a care photo or a Server preference contract.
export type PickedBackgroundImage = {
  uri: string;
  filename: string;
  dispose: () => void;
};

export type PickBackgroundImage = () => Promise<PickedBackgroundImage | null>;

export type BackgroundImagePickerProps = {
  onSelected: (image: PickedBackgroundImage) => void;
  onError: (message: string) => void;
  onReadingChange: (reading: boolean) => void;
  pickImage?: PickBackgroundImage;
};
