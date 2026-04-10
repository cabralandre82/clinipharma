'use client'

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getMessaging, getToken, onMessage, type Messaging } from 'firebase/messaging'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

let app: FirebaseApp | null = null
let messaging: Messaging | null = null

function getFirebaseApp(): FirebaseApp {
  if (!app) {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]
  }
  return app
}

function getFirebaseMessaging(): Messaging | null {
  if (typeof window === 'undefined') return null
  if (!messaging) {
    try {
      messaging = getMessaging(getFirebaseApp())
    } catch {
      return null
    }
  }
  return messaging
}

export async function requestPushPermission(): Promise<string | null> {
  try {
    if (!('Notification' in window)) return null
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return null

    const m = getFirebaseMessaging()
    if (!m) return null

    const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY
    if (!vapidKey || vapidKey === 'PENDING_GENERATE_FROM_FIREBASE_CONSOLE') {
      console.warn(
        '[push] VAPID key not configured. Set NEXT_PUBLIC_FIREBASE_VAPID_KEY in env vars.'
      )
      return null
    }

    const token = await getToken(m, {
      vapidKey,
      serviceWorkerRegistration: await navigator.serviceWorker.register(
        '/firebase-messaging-sw.js'
      ),
    })

    return token ?? null
  } catch (err) {
    console.warn('[push] Failed to get FCM token:', err)
    return null
  }
}

export function onForegroundMessage(
  callback: (payload: { title?: string; body?: string; link?: string }) => void
) {
  const m = getFirebaseMessaging()
  if (!m) return () => {}
  return onMessage(m, (payload) => {
    callback({
      title: payload.notification?.title,
      body: payload.notification?.body,
      link: payload.data?.link,
    })
  })
}
