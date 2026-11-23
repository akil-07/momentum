import { useSyncExternalStore } from 'react'

// Chrome/Edge/Android fire this when the app is installable; we hold on to it for our own Install button.
type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: BIP | null = null
const subs = new Set<() => void>()
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e as BIP; subs.forEach(f => f()) })
addEventListener('appinstalled', () => { deferred = null; subs.forEach(f => f()) })

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
export const useCanInstall = () => useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb) } }, () => !!deferred)
export async function install() { if (!deferred) return; await deferred.prompt(); deferred = null; subs.forEach(f => f()) }
