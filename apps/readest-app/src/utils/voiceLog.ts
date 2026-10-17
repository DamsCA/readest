import { isTauriAppPlatform } from '@/services/environment';

// A line in the device's log (adb logcat), where the app's console does not
// go: the only way to see what the voice does with the screen off.
export const voiceLog = (message: string) => {
  console.log(message);
  if (!isTauriAppPlatform()) return;
  void import('@tauri-apps/plugin-log').then(({ info }) => info(message)).catch(() => {});
};
