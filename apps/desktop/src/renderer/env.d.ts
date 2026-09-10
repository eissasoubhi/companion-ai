export {};

declare global {
  interface Window {
    companion: {
      readonly platform: string;
    };
  }
}
