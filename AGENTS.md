# AGENTS.md

Jueguitos: sitio **100 % estático** (Vite + React + TypeScript). Amigos crean un perfil local,
el anfitrión crea una sala con código y los invitados se conectan por WebRTC (PeerJS).
Sin backend, base de datos, cuentas ni claves.

## Comandos

- `npm run dev` — servidor Vite. Sin Fast Refresh: `@vitejs/plugin-react` no está instalado y
  los cambios recargan la página entera.
- `npm test` — Vitest (`src/**/*.test.ts`, entorno node). Solo lógica pura; no hay jsdom.
- `npm test -- src/roomCode.test.ts` — un único archivo de tests.
- `npm run build` — `tsc --noEmit && vite build`. Debe quedar verde.
- `npm run preview` — sirve `dist/`.

## Restricciones duras

- Dependencias de runtime: exactamente `react`, `react-dom`, `peerjs`. Dev: `vite`, `typescript`,
  `vitest` (+ `@types/react`, `@types/react-dom`, solo tipos). Nada de router, UI kits, Tailwind,
  librerías de estado ni testing-library.
- Prohibido: backend/DB, servicios de pago, API keys, auth con email, modo oscuro, chat, ranking,
  analytics, o funciones fuera del brief.
- No ejecutar `git push`, deploy ni comandos fuera de esta carpeta.
- **Preguntar antes de** añadir una dependencia, borrar archivos, cambiar el contrato
  `GameDefinition`, o si un error de conexión persiste tras 3 intentos de arreglo.

## Arquitectura

- `src/App.tsx` — navegación por estado de React (`catalog | profile | join | host | guest`).
  No hay router ni rutas de URL. `base: './'` en `vite.config.ts` mantiene el build portable.
- `src/net/useHostRoom.ts` — **anfitrión autoritativo**. La sala completa vive en `roomRef`; valida
  cada acción con el reducer del juego y difunde `RoomSnapshot` completos. Al caer un invitado
  conserva su asiento con `connected: false`.
- `src/net/useGuestRoom.ts` — invitado. Envía `{kind:'hello'|'action'}` y solo pinta snapshots.
  Reintenta 3 veces y después muestra que el anfitrión cerró la sala.
- `src/net/protocol.ts` — tipos del cable + `sanitizeProfile`/`sanitizeSeatId`. No confiar en
  payloads de invitados.
- `src/roomCode.ts` — 5 caracteres de `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (sin I/O/0/1); el código
  es el id de PeerJS `jueguitos-<CODIGO>`.
- `src/profile.ts` — perfil en `localStorage['jueguitos.profile']`.
- `src/games/index.ts` — registro. Cada juego vive en `src/games/<id>/`.

## Trampas verificadas

- El asiento del invitado es un id **por pestaña** en `sessionStorage` (`jueguitos.seat.<CODIGO>`),
  no el id del perfil: dos pestañas comparten `localStorage`, y con el id del perfil la segunda
  pestaña ocuparía el asiento del anfitrión. Recargar la pestaña conserva el asiento; cerrarla no.
- `src/main.tsx` omite `<StrictMode>` a propósito: el doble montaje de efectos hace que PeerJS
  registre dos veces el id del anfitrión (`unavailable-id`).
- `reduce` debe ser puro y determinista; el azar sale de `seed` guardada en el estado. El estado de
  un juego **no** puede tener una clave `error` de tipo string: esa forma significa rechazo.
- El anfitrión solo difunde cuando cambia el estado; el invitado nunca muta el estado local.
- `crypto.randomUUID` exige contexto seguro; `randomId()` en `src/profile.ts` tiene fallback con
  `getRandomValues` para probar en `http://` por LAN.
- Añadir un juego: crear `src/games/<id>/index.tsx` con un `GameDefinition` y añadir una línea en
  `src/games/index.ts`. Quitar un juego: eliminar `src/games/<id>/` y su línea del registro.

## Verificación

- La puerta es `npm run build` + `npm test`.
- El navegador integrado de OpenCode tiene WebRTC desactivado (un loopback local de
  `RTCPeerConnection` no pasa de `new`), así que la sincronización entre dos peers solo se puede
  comprobar a mano en dos pestañas de un navegador normal; los pasos están en `README.md`.
- Deploy: `.github/workflows/deploy.yml` publica `dist/` en GitHub Pages al hacer push a `main`
  (la fuente de Pages debe ser "GitHub Actions").
