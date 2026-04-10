// Firebase Cloud Messaging Service Worker
// This file must be at the root of the public directory.

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js')

// Config is injected at runtime from /api/push/sw-config
// Fallback to hardcoded values for environments where dynamic config isn't available
const firebaseConfig = {
  apiKey: 'AIzaSyCwBdcB8Ibgq4lBVWwz1_hmrkzDxIwnIto',
  authDomain: 'clinipharma-d7797.firebaseapp.com',
  projectId: 'clinipharma-d7797',
  storageBucket: 'clinipharma-d7797.firebasestorage.app',
  messagingSenderId: '67520190566',
  appId: '1:67520190566:web:927fdadd22238ff26b35a7',
}

firebase.initializeApp(firebaseConfig)
const messaging = firebase.messaging()

// Background message handler
messaging.onBackgroundMessage((payload) => {
  const { title, body, icon } = payload.notification ?? {}
  const link = payload.data?.link ?? '/'

  self.registration.showNotification(title ?? 'Clinipharma', {
    body: body ?? '',
    icon: icon ?? '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: link },
    requireInteraction: false,
  })
})

// Click notification → open link
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/'
  event.waitUntil(clients.openWindow(url))
})
