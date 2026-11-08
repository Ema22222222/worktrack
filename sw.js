// sw.js — funcționare offline (cache) și primirea notificărilor push (Firebase Cloud Messaging).
/* global importScripts, firebase */
const VERSION = 'wt-v7';
const CORE = ['./', './index.html', './css/app.css', './js/web/boot.js', './manifest.webmanifest', './icons/icon-192.png'];

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
firebase.initializeApp({
  apiKey: 'AIzaSyDA5ePmiKywraYIIryIxdPdWs9EJIilsBQ',
  authDomain: 'worktrack-4935c.firebaseapp.com',
  projectId: 'worktrack-4935c',
  storageBucket: 'worktrack-4935c.firebasestorage.app',
  messagingSenderId: '456434024323',
  appId: '1:456434024323:web:33de338672a4ac754540b6',
});
// Notificările cu „notification” sunt afișate automat de Firebase; mesajele doar cu date le afișăm noi.
firebase.messaging().onBackgroundMessage((msg) => {
  if (msg.notification) return;
  const d = msg.data || {};
  self.registration.showNotification(d.title || 'WorkTrack', { body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: d.tag || undefined, data: { link: d.link || './#azi' } });
});

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Fișierele aplicației: întâi rețeaua (ca să vină imediat versiunea nouă), apoi cache-ul când nu e internet.
// Bibliotecile și fonturile externe: întâi cache-ul. Cererile către bazele de date Google nu sunt atinse.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (/googleapis\.com$/.test(url.hostname) && !/fonts\.googleapis\.com$/.test(url.hostname)) return;
  if (url.hostname.endsWith('firebaseapp.com') || url.hostname.endsWith('google.com')) return;
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
    return;
  }
  if (/(gstatic\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com)$/.test(url.hostname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const link = e.notification.data?.link || e.notification.data?.FCM_MSG?.notification?.click_action || './#azi';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) { c.navigate?.(link); return c.focus(); }
    return self.clients.openWindow(link);
  }));
});
