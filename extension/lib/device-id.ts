// 이 브라우저 프로필의 기기 id. 이벤트 배치와 팀 수집 창이 같은 값을 써야 서버가 "이 기기의 창"을 판정한다.
const DEVICE_ID_KEY = 'orbit:deviceId';

let deviceIdPromise: Promise<string> | null = null;

export async function getDeviceId(): Promise<string> {
  if (!deviceIdPromise) {
    deviceIdPromise = (async () => {
      const stored = await chrome.storage.local.get(DEVICE_ID_KEY);
      const existing = stored[DEVICE_ID_KEY] as string | undefined;
      if (existing) return existing;
      const generated = crypto.randomUUID();
      await chrome.storage.local.set({ [DEVICE_ID_KEY]: generated });
      return generated;
    })();
  }
  return deviceIdPromise;
}
