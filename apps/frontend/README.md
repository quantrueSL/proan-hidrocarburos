# Frontend (Next.js 14)

Interfaz de Hidrocarburos: clasificación de facturas de gas, portal de Compras,
aprobación de Gerencia y dashboard. App Router, componentes de servidor por
defecto, estética Proan.

## Estructura

```
app/
  login/                     pantalla de acceso
  (authenticated)/           todo lo que exige sesión
    hidrocarburos/           M1 · clasificación
    compras/                 M2 · portal de Compras + historial
    aprobacion/              M3 · aprobación de Gerencia (solo rol gerencia)
    dashboard/  manual/
  api/
    auth/{login,google,logout}
    financialbi/hidrocarburos/...   proxy al backend
src/
  lib/auth/                  sesión firmada, roles, lista de acceso, Firebase
  lib/gateway.ts             llamadas al backend FinancialBI
  features/                  workspaces de aprobación y dashboard
  components/                piezas compartidas
  skin/proan/                marca, tema y shell
client.config.ts             ruta por defecto, branding, features
```

## Autenticación y roles

Dos vías que emiten **la misma cookie de sesión firmada**: usuario y contraseña
contra `.htpasswd` (bcrypt, verificado dentro de Next) y "Entrar con Google"
sobre Firebase Authentication. El rol (`gerencia` o `generico`) vive en la sesión
y, en el caso de Google, se resuelve contra una lista en Firestore.

El detalle completo —decisiones, matriz de permisos, cómo dar acceso a alguien y
las trampas a recordar— está en `docs/login/LOGIN.md`.

Lo esencial para trabajar aquí:

- La autorización se aplica **en el servidor**. Ocultar un botón es cosmético.
- La identidad que se graba en BigQuery sale de la sesión, nunca del body.
- `SESSION_SECRET` es obligatorio en producción; en desarrollo hay un valor por
  defecto con aviso.

## Desarrollo

Se levanta con el stack completo desde la raíz del repo (ver su README):

```bash
docker compose -f deploy/docker-compose.dev.yml up --build
```

Comprobaciones, desde `apps/frontend`:

```bash
corepack pnpm test                  # vitest
./node_modules/.bin/tsc --noEmit
corepack pnpm lint
```

Los tests cubren la lógica pura de `src/lib/auth/`: firma y caducidad de la
cookie, política de rutas por rol, parseo de la lista de acceso y claims de
Google. Para eso los módulos puros están separados de los que hablan con
Firestore o con `next/headers` — al añadir lógica de autorización, mantener esa
separación es lo que la hace testeable.

Gestor de paquetes: **pnpm 10.12.4** vía corepack, la versión declarada en
`package.json` y la que usan las imágenes. Instalar con otro pnpm global da
`ERR_PNPM_UNEXPECTED_STORE`.

## Producción

Imagen `Dockerfile.prod` (salida `standalone` de Next, respeta `$PORT`). Se
despliega junto al backend en un único servicio de Cloud Run con dos
contenedores; ver `deploy/cloudrun/README.md`.
