# Jueguitos

Juegos multijugador entre amigos en un sitio **100 % estático**. Sin backend, sin base de datos,
sin cuentas y sin claves de API.

- Cada persona crea un perfil local (nombre + emoji + color) que se guarda **solo en su navegador**.
- El anfitrión crea una sala y obtiene un código de 5 caracteres.
- Los invitados entran con ese código y se conectan por WebRTC (PeerJS).
- El navegador del anfitrión es el servidor: guarda el estado, valida las acciones y lo difunde todo.

## Correr en local

Requisitos: Node 18 o superior.

```bash
npm install
npm run dev
```

Abre la URL que imprime Vite (por defecto `http://localhost:5173`).

Otros comandos:

```bash
npm run build     # typecheck + build estático en dist/
npm run preview   # sirve dist/ en local
npm test          # tests con Vitest
```

### Probar con dos pestañas

1. `npm run dev` y abre `http://localhost:5173` en la pestaña A. Crea un perfil.
2. Elige **Cucupoly** y pulsa **Crear sala**. Anota el código de 5 caracteres.
3. Abre la misma URL en la pestaña B (o en el móvil dentro de tu red local) y crea **otro** perfil.
4. Pulsa **Unirse con código**, escribe el código y entra.
5. En la pestaña A pulsa **Iniciar partida**: arranca la **subasta sorpresa** inicial. En cada
   pestaña puja (mínimo el 75% del precio) o pulsa **Pasar**; la subasta termina cuando todos
   han decidido.
6. Juega unos turnos: **Tirar dados**, decidir compras, caer en Sorpresa (mesa de 21, 1 dado o 3
   dados) y en Tesorería. Comprueba que las dos pantallas muestran el mismo dinero y las mismas
   fichas.
7. Con un servicio en propiedad, en tu turno pulsa **Activar** en el panel de Habilidades y revisa
   que el estado pase a «activa» y luego a «espera N r.».
8. Con las 4 busetas, cae en una buseta y usa **Saltar** para moverte gratis a la siguiente.
9. Para ver la bancarrota sin jugar una partida larga, deja que un jugador se quede sin dinero y
   caiga en una casilla con renta o impuesto: queda eliminado, sus propiedades pasan al acreedor
   (o al banco) y gana el último jugador activo.

Para simular una reconexión: cierra la pestaña B, vuelve a abrirla con el mismo perfil y entra con
el mismo código. El asiento se conserva y la partida sigue en la pestaña A.

## Desplegar gratis en GitHub Pages

El repositorio incluye `.github/workflows/deploy.yml`.

1. Sube el proyecto a un repositorio de GitHub.
2. En **Settings → Pages → Build and deployment**, elige **GitHub Actions** como origen.
3. Haz push a `main`. El workflow ejecuta tests, construye y publica `dist/`.

`vite.config.ts` usa `base: './'`, así que el sitio funciona tanto en `usuario.github.io/repo/`
como en un dominio propio. No hay rutas del servidor: toda la navegación es estado de React.

## Limitaciones conocidas

- **El perfil es por navegador.** No hay cuentas ni sincronización: si borras los datos del
  navegador o cambias de dispositivo, el perfil desaparece.
- **El anfitrión debe seguir conectado.** El estado de la partida vive en su pestaña. Si la cierra,
  la sala termina y los invitados ven un aviso.
- **NAT estricto.** PeerJS usa el servidor público de señalización de PeerJS, pero no hay servidor
  TURN. Algunas redes corporativas, móviles o con NAT simétrico pueden impedir la conexión WebRTC.
- **No hay persistencia de partidas.** Al recargar la página del anfitrión se pierde la sala.
- **Reconexión por pestaña.** El asiento del invitado vive en `sessionStorage`: recargar la pestaña
  mantiene el asiento y el marcador, pero si la cierras y la vuelves a abrir entras como jugador
  nuevo (el asiento antiguo queda marcado como desconectado).

## Añadir un juego

1. Crea `src/games/<id>/index.tsx` y exporta un `GameDefinition` (ver `src/types.ts`):

   ```ts
   export type GameDefinition<S> = {
     id: string
     name: string
     description: string
     minPlayers: number
     maxPlayers: number
     init(players: Player[], seed: number): S
     reduce(state: S, action: GameAction, playerId: string): S | { error: string }
     View: ComponentType<GameViewProps<S>>
   }
   ```

2. `reduce` debe ser **puro y determinista**: nada de `Math.random()` ni `Date.now()`. Guarda la
   semilla dentro del estado si el juego necesita azar.
3. Registra el juego en `src/games/index.ts`.

Para quitar un juego, borra `src/games/<id>/` y su línea en el registro.

## Estructura

```
src/
  App.tsx            navegación por estado (sin router)
  profile.ts         perfil en localStorage
  roomCode.ts        código de sala + id de PeerJS
  net/               protocolo y hooks de anfitrión/invitado (PeerJS)
  games/             catálogo de juegos como plug-ins
  screens/           perfil, catálogo, unirse, sala/partida
```
