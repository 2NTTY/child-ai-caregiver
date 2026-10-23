// Display-only selection port. Wallpaper is not a care photo or a Server preference contract.
export type PickedBackgroundImage = {
  uri: string;
  filename: string;
  blob?: Blob; // Web-only local Blob; never sent to an API.
  dispose: () => void;
};

export type PickBackgroundImage = () => Promise<PickedBackgroundImage | null>;

export type BackgroundImagePickerProps = {
  onSelected: (image: PickedBackgroundImage) => void | Promise<void>;
  onError: (message: string) => void;
  onReadingChange: (reading: boolean) => void;
  pickImage?: PickBackgroundImage;
  disabled?: boolean;
};
