// Phone alerts, the browser's side. The server side is amplify/functions/push.
//
// A phone gets alerts when three things are true: the browser supports web
// push, the person allowed notifications, and the phone's subscription is
// saved on the server. On an iPhone the first is only true after the site is
// added to the Home Screen.
import { api } from './api';

export type AlertState =
  | 'preview' // sample data; there is no server to send anything
  | 'unsupported' // this browser cannot show alerts
  | 'needs-install' // iPhone or iPad in Safari: add to the Home Screen first
  | 'blocked' // notifications denied in the phone's settings
  | 'off' // possible, not turned on yet
  | 'on'; // this phone gets alerts

// Chrome on Android offers to install the app through this event.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installPrompt: BeforeInstallPromptEvent | null = null;

export function registerServiceWorker(): void {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // no alerts on this browser; the board itself is unaffected
    });
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e as BeforeInstallPromptEvent;
  });
}

export const isStandalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIOS = (): boolean =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone|iPod/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Phone';
}

const supported = (): boolean => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator)) return undefined;
  return (await navigator.serviceWorker.getRegistration()) ?? undefined;
}

export async function alertState(): Promise<AlertState> {
  if (api.mode !== 'aws') return 'preview';
  if (!supported()) return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub ? 'on' : 'off';
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function save(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  const keys = json.keys ?? {};
  await api.subscribePush({ endpoint: sub.endpoint, p256dh: keys.p256dh ?? '', auth: keys.auth ?? '', device: deviceLabel() });
}

// Asks the phone, then tells the server about this phone.
export async function turnOn(): Promise<AlertState> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const key = await api.pushPublicKey();
  if (!key) throw new Error('Alerts are not ready on the server yet. Try again in a minute.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  await save(sub);
  return 'on';
}

export async function turnOff(): Promise<AlertState> {
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    try {
      await api.unsubscribePush(sub.endpoint);
    } catch {
      // the server row is cleaned up the next time a push to it fails
    }
    await sub.unsubscribe();
  }
  return 'off';
}

// A phone can change hands. When someone signs in on a phone that already
// gets alerts, the subscription is re-pointed at them and their restaurant.
export async function rebind(): Promise<void> {
  if (api.mode !== 'aws' || !supported()) return;
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    try {
      await save(sub);
    } catch {
      // not fatal; the Alerts sheet still works
    }
  }
}

export const canPromptInstall = (): boolean => installPrompt !== null;

export async function promptInstall(): Promise<boolean> {
  if (!installPrompt) return false;
  await installPrompt.prompt();
  const choice = await installPrompt.userChoice;
  installPrompt = null;
  return choice.outcome === 'accepted';
}
