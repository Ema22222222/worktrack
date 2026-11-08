# WorkTrack Pro Max

Pontaj personal: ore lucrate, pauze, activități, ore extra, sărbători, producție, plăți și foaia de ore pentru birou (PDF în spaniolă).

- **Site:** https://ema22222222.github.io/worktrack/
- **Date:** Firebase (Firestore), fiecare utilizator își vede doar datele lui (reguli de securitate pe `users/{uid}`).
- **Offline:** service worker + cache Firestore; înregistrările se sincronizează când revine internetul.
- **Notificări:** `.github/workflows/reminders.yml` rulează la 15 minute `scripts/send-reminders.mjs` și trimite alertele prin Firebase Cloud Messaging. Are nevoie de secretul `FIREBASE_SERVICE_ACCOUNT`.

## Structură
- `js/calc.js` – motorul de calcul (ore efective, ore extra, sărbători, normă, bani), testat în `tests/`.
- `js/store.js` – stocare cu istoric, coadă offline, backup.
- `js/pages/*` – paginile aplicației; `js/hoja.js` – foaia de ore în spaniolă.
- `js/web/boot.js` – logare, Firestore, notificări (doar pe site).

## Teste
```
node tests/calc.test.mjs && node tests/store.test.mjs && node tests/reminders.test.mjs
```
