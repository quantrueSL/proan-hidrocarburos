# Login y roles

Estado y decisiones del acceso a Hidrocarburos. Capas 0–3 hechas y en uso;
Capa 4 (producción en Cloud Run) pendiente. Última actualización: 2026-07-29.

---

## 1. Cómo funciona

Dos vías de login que acaban en la **misma cookie de sesión firmada**; a partir de
ahí la aplicación no sabe por dónde entró nadie.

```
Entrar con Google ──► Firebase Auth ──► POST /api/auth/google ──┐
                      (proan-quantrue)   verifica token,        │
                                         consulta lista         ├──► cookie
                                                                │    firmada
Usuario/contraseña ─► POST /api/auth/login ─────────────────────┘    (rol dentro)
                      .htpasswd bcrypt → rol gerencia
```

- El login **no está en nginx**: lo hace Next.js. nginx solo termina TLS.
- Cookie: `<base64url(JSON)>.<base64url(HMAC-SHA256)>`, secreto en
  `SESSION_SECRET`. El payload es legible (correo, rol, caducidad: nada secreto);
  lo que no se puede es escribirlo sin el secreto. Caducidad comprobada **en el
  servidor**.
- **Firebase dice quién eres; la lista de Firestore dice qué puedes hacer aquí.**
  Cada aplicación tendrá su documento de lista; así el directorio compartido de
  Proan escala sin que existir en él dé acceso a todo.

**Ficheros clave** (`apps/frontend/`):

| | |
|---|---|
| `src/lib/auth/session-token.ts` | firma y verifica la cookie (puro) |
| `src/lib/auth/roles.ts` | tipo de rol y predicados |
| `src/lib/auth/aprobacion-policy.ts` | lista blanca ruta → rol necesario |
| `src/lib/auth/access-list.ts` | parseo y decisión de acceso (puro) |
| `src/lib/auth/access-list-firestore.ts` | lectura con caché (solo servidor) |
| `src/lib/auth/google-login.ts` | comprobación de claims del token |
| `src/lib/auth/firebase-admin.ts` | init compartido de firebase-admin |
| `app/api/auth/google/route.ts` | canje de ID token por cookie |
| `app/api/financialbi/.../aprobacion/[...path]/route.ts` | autorización de las mutaciones |

---

## 2. Decisiones

1. Dos vías de login que coexisten: Google (sin contraseña) y `.htpasswd`.
2. La identidad federada va sobre **Firebase Authentication**, no OAuth directo:
   será la capa de identidad de todos los proyectos de Proan, y así nuestra app no
   custodia ningún *client secret*.
3. Firebase vive en **`proan-quantrue`**. Solo proyectos de Proan; si algún día
   entra otro cliente, no va aquí.
4. **Sin filtro de dominio en el código**: la lista es la única autoridad *para la
   aplicación*. Google añade por su cuenta un filtro de organización (ver §5).
5. Dos roles: `gerencia` (todo) y `generico`. El genérico es el que pierde
   capacidades, nunca el que gana. Rol desconocido → `generico`.
6. Los usuarios de `.htpasswd` son siempre `gerencia`: es la vía de Quantrue y de
   administración.
7. El rol vive en la sesión firmada del servidor, nunca en el body.
8. Despliegue: **Cloud Run**, un servicio con dos contenedores. Ver
   `deploy/cloudrun/`.

---

## 3. Matriz de permisos

El genérico no acepta ni rechaza facturas. Todo lo demás lo tiene.

| Acción | Ruta backend | `generico` | `gerencia` / `.htpasswd` |
|---|---|:--:|:--:|
| Ver Clasificación, Compras, Dashboard, Manual | GET varios | sí | sí |
| Validar en Compras (CECO, centro) | `compras/{uuid}/validar` | sí | sí |
| **Rechazar en Compras** | `compras/{uuid}/rechazar` | **no** | sí |
| Reabrir una factura | `{uuid}/reabrir` | sí | sí |
| Ver la pestaña Aprobación | — | **no** | sí |
| Aprobar / rechazar (Gerencia) | `gerencia/{uuid}/*` | **no** | sí |
| Bandeja de Gerencia | GET `gerencia` | **no** | sí |

Cada restricción se aplica **en el servidor**; ocultar en la interfaz es cosmético.
La política es una lista blanca: una forma de ruta no declarada se deniega.

La identidad que se graba en BigQuery (`usuario_compras`, `usuario_gerencia`) se
inyecta desde la sesión. El componente de React ya no recibe el correo, así que no
puede expresar una identidad. Cierra la deuda D27.

---

## 4. Modelo de datos

Firestore, base **`proan-lista-mails`**, colección `lists`. Se gestiona desde la
app Mailing-lists (`proan-DBC/Mailing-lists`).

```
lists/hidrocarburos_acceso
  name    "Acceso Hidrocarburos"
  emails  ["quantrue1@proan.com", "quantrue4@proan.com"]   ← quién entra
  roles   { "quantrue4@proan.com": "gerencia" }            ← qué puede hacer
  kind    "access"          enabled  true
  updated_at, updated_by, comment
```

- `emails[]` es plano **para no romper `Cambio divisa/divisa.py`**, que lo lee así.
- **`emails` es la puerta; `roles` solo reparte.** Correo con rol pero fuera de
  `emails` no entra. En `emails` sin rol → `generico`.
- `kind`: `access` o `mailing` (por defecto si falta). Decide la sección de la
  interfaz y si aparece el desplegable de rol.
- `enabled: false` corta el acceso de toda la lista.

**Decisión de acceso**: `allowed{role}` · `denied{list-missing|list-disabled|not-listed}`
· `unavailable` (Firestore no respondió). `unavailable` también deniega — nunca se
concede por defecto — y se distingue para dar un mensaje distinto. Si Firestore
está caído, la entrada es el `.htpasswd`.

### Dar acceso a alguien

**Persona con cuenta `@proan.com`** (lo normal): en el portal de listas, sección
*Accesos*, añadir el correo y elegir su rol. Efecto en ≤45 s (caché). Sin
despliegues.

**Buzón compartido** (`facturacion@`, `soporte@`): comprobar antes qué es en
Workspace. Un **grupo o lista de distribución no puede iniciar sesión nunca** (no
hay cuenta detrás). Un **alias** devuelve el correo *principal* en el token, así
que hay que poner ese. Y una cuenta compartida hace que las validaciones queden
firmadas por una dirección y no por una persona: si va a validar facturas, mejor
cuentas nominales.

**Correo de fuera de `proan.com`** (gmail, `@quantrue.com`, `@inovaalimentos.com`):
añadirlo a la lista **no basta**, ver §5.

---

## 5. Filtro de organización (Google)

`proan-quantrue` cuelga de la organización **proan.com** y su pantalla de
consentimiento OAuth está en modo **Internal**. Google restringe por su cuenta el
login a cuentas `@proan.com`: cualquier otra recibe `Error 403: org_internal` sin
llegar a nuestro código.

**Se mantiene así**: los usuarios reales son de ese dominio y quedan dos puertas en
serie. Consecuencia: **nadie de fuera de proan.com puede entrar por Google.** Para
permitirlo habría que, en la consola de Google Cloud (*APIs y servicios* →
*Pantalla de consentimiento de OAuth*, o *Google Auth Platform* → *Audiencia*):

1. Cambiar de **Internal** a **External**.
2. **Publicar** la aplicación (en *Testing* solo entran hasta 100 correos dados de
   alta a mano). No requiere revisión de Google: solo pedimos `openid`, `email` y
   `profile`.

Amplía sin romper nada, pero **afecta al proyecto compartido**, y a partir de ahí
la lista de Firestore pasa a ser la única puerta. `@quantrue.com` seguirá sin
funcionar en cualquier caso: es Microsoft y no tiene cuenta de Google detrás.

---

## 6. Trampas a recordar

Lo que se olvida y luego cuesta un rato encontrar.

**El proyecto Firebase está compartido.** Tiene otras dos apps web (`pedidos-dbc`,
`portal-proan-web`) y el proveedor *Correo electrónico/contraseña* habilitado con
~15 cuentas de sucursal. **No tocar nada de eso.** Y de ahí lo importante: un token
obtenido con contraseña es tan válido como uno de Google, así que
`/api/auth/google` **exige `firebase.sign_in_provider === "google.com"`**. Sin esa
comprobación, el día que un correo de esos entrase en la lista tendría dos puertas.

**El rol se fija al iniciar sesión.** La lista se consulta una vez y el rol queda
en la cookie. Cambiar un rol en Firestore no afecta a una sesión abierta, y **quitar
a alguien de la lista no lo echa**: le impide el siguiente login, pero su sesión
vale hasta caducar (8 h). Para revocación inmediata habría que revalidar en cada
petición: con la caché saldría casi gratis, pero exige volver asíncrono
`getSession()`, hoy sincrónico y usado desde muchos componentes de servidor.

**La caché de la lista es de 45 s** y no sirve datos caducados ni cuando Firestore
falla: alargarla ampliaría sin límite la ventana en la que alguien dado de baja
sigue entrando.

**`save_list` escribe el documento entero con `set()` sin `merge`.** Es la única
forma de que quitar un correo o un rol surta efecto. A cambio: **si se añade un
campo al modelo hay que añadirlo también a `firestore_payload`**, o se perderá en
cada guardado. `roles` y `kind` se conservan del documento existente cuando el
cliente no los envía (se distingue omitir de vaciar).

**Al crear una lista a mano hay que poner `kind`.** Sin él se interpreta como
`mailing` y una lista de acceso aparece en la sección de correo, sin roles.

**Borrar una lista en la consola deja el `history` huérfano**: Firestore no borra
subcolecciones en cascada. El endpoint `DELETE` (sin botón en la interfaz) sí lo
limpia.

**Configuración de Firebase sin `NEXT_PUBLIC_`.** Se lee en el servidor y se pasa
como props: con ese prefijo se incrusta en el bundle al compilar y la misma imagen
no serviría para dos entornos.

**No metas comentarios dentro de un comando encadenado con `\`.** Le pasaba a
`deploy.sh` de Mailing-lists: se desplegaba sin `--set-env-vars` ni
`--set-secrets`, y funcionaba solo porque Cloud Run conserva la configuración
anterior. Corregido.

**pnpm 10.12.4**, la versión que declara `package.json` y con la que construyen las
imágenes vía corepack. Instalar con un pnpm global distinto da
`ERR_PNPM_UNEXPECTED_STORE`; se resuelve reinstalando con la declarada
(`corepack pnpm install`).

---

## 7. Estado por capas

### Capa 0 — Sesión firmada y autorización ✅

- [x] Cookie firmada con HMAC-SHA256 (`node:crypto`, sin dependencias nuevas).
- [x] Firma inválida o sesión caducada → "no hay sesión". La caducidad se
      comprueba **en el servidor**: una cookie copiada no expiraría por su cuenta.
- [x] `role` en `FrontendSession`; ausente o desconocido → `generico`.
- [x] Login por `.htpasswd` → `gerencia`.
- [x] 403 en el proxy POST para `gerencia/*` y `compras/*/rechazar`, con lista
      blanca de rutas: lo no declarado se deniega.
- [x] GET de la bandeja de Gerencia restringido también.
- [x] `usuario` inyectado desde la sesión en las cuatro rutas mutables.
- [x] Pestaña Aprobación y botón Rechazar ocultos al genérico.
- [x] `/aprobacion` por URL directa redirige.
- [x] `SESSION_SECRET` en los compose de dev y prod.
- [x] Tests de cookie manipulada, firma alterada, caducidad y política de rutas.

`SESSION_SECRET` es obligatorio en producción (mínimo 32 caracteres) y el arranque
falla sin él; en desarrollo hay un valor por defecto con aviso. Al desplegar la
capa, las sesiones abiertas dejaron de valer: la cookie antigua no lleva firma.

### Capa 1 — Lista de acceso en Firestore ✅

- [x] Documento `lists/hidrocarburos_acceso` creado, con `kind: "access"`.
- [x] Permiso de Firestore: **no hizo falta**, la service account
      `272166156031-compute@` ya tiene rol *Editor* (bastaría
      `roles/datastore.viewer`, y se puede acotar a una base con una condición).
- [x] Credenciales de GCP montadas en el contenedor del frontend: solo las tenía
      el backend, y es el frontend quien lee la lista.
- [x] Lectura con caché de 45 s, anti-estampida y sin cachear los fallos.
- [x] Resolución de rol según §4, con correos normalizados en los dos lados.
- [x] Fallo de Firestore → denegar, nunca conceder por defecto.
- [x] Verificado contra el Firestore real, no solo con tests.

Credenciales por `applicationDefault()`: en Cloud Run lo resuelve la identidad del
servicio; en desarrollo, el compose monta `../config` y
`GOOGLE_APPLICATION_CREDENTIALS`.

Comprobación rápida de conectividad y permisos, desde `apps/frontend`:

```bash
GOOGLE_APPLICATION_CREDENTIALS=../../config/bq_credentials.json \
  node scripts/read-access-list.mjs
```

### Capa 2 — Entrar con Google ✅

Consola (casi todo estaba ya hecho por las otras herramientas del proyecto):

- [x] Authentication habilitado. Ya lo estaba.
- [x] Proveedor Google habilitado. Ya lo estaba, junto al de contraseña, que usa
      otra app: **no tocarlo**.
- [x] Cliente OAuth y pantalla de consentimiento: ya existían.
- [x] Dominios autorizados: `localhost` viene de fábrica.
- [x] App web `hidrocarburos-frontend` registrada (la tercera del proyecto).

Código:

- [x] `firebase` (cliente) y `firebase-admin` (servidor) instalados.
- [x] Botón "Entrar con Google" con carga diferida del SDK.
- [x] `POST /api/auth/google`: verifica el token, consulta la lista y emite la
      misma cookie firmada que el `.htpasswd`.
- [x] **Exigir `sign_in_provider === "google.com"`** (ver §6).
- [x] 401 / 403 / 503 según el motivo, con mensaje propio.
- [x] Init de `firebase-admin` compartido con la Capa 1.
- [x] Cadena de servidor verificada sin navegador (login, 400, 401 y credenciales
      dentro del contenedor).
- [x] Probado en el navegador con dos cuentas `@proan.com`, una por rol.
- [x] Gmails de prueba retirados de la lista: con Internal no podían entrar.
- [x] Jerarquía de la pantalla de login rehecha.

El SDK de cliente se carga con `import()` dinámico dentro del botón, así que no
pesa en la pantalla de login ni lo descarga quien entra por contraseña. Tras
obtener el token se cierra la sesión de Firebase en el navegador: la sesión de la
app es nuestra cookie. Se fuerza `prompt: "select_account"` para poder cambiar de
cuenta.

Pantalla de login: Google es la única acción destacada y el usuario/contraseña se
repliega tras un `<details>` ("Acceso para desarrolladores"), que se abre solo si
Firebase no está configurado — si no, quedaría una pantalla sin nada que pulsar.

### Capa 3 — Gestión de roles desde Mailing-lists ✅

- [x] `roles` se escribe en `save_list` y **se conserva cuando el cliente no lo
      manda**: era lo que impedía usar la interfaz sin borrar los permisos.
- [x] Desplegable de rol por fila, solo en las listas de acceso.
- [x] Dos secciones separadas por el campo `kind`, no solo un aviso visual.
- [x] `updated_by` desde la sesión de Flask.
- [x] Endpoints nuevos: `DELETE /api/lists/<id>`, `.../history` y `/api/session`.
- [x] Crear y borrar listas fuera de la interfaz (ver abajo).
- [x] Repaso visual con la paleta de Hidrocarburos, login incluido.
- [x] Desplegado (`mailing-lists-00007-hjl`) y verificado contra Firestore: se
      cambió un rol desde la interfaz y el mapa `roles` siguió completo.

Bugs de la app corregidos por el camino, ninguno relacionado con los roles:

- Ninguna lista nueva se podía nombrar (el nombre salía de un `<span>` con "Nueva
  lista" y el backend forzaba el existente).
- Guardar reactivaba una lista desactivada (`enabled: true` fijo en el cliente).
- Cambiar de lista descartaba los cambios en silencio.
- El historial se escribía, nadie lo veía y todo decía `updated_by: "system"`.

Crear y borrar listas se quedan fuera: son operaciones estructurales y una lista
nueva no sirve hasta que algún código la lee. La app gestiona quién está en las
listas; las listas, la consola. Campos necesarios, en el README de Mailing-lists.

### Capa 4 — Producción en Cloud Run

**Arquitectura: un servicio, dos contenedores.** El frontend es la entrada y
`financialbi` va como *sidecar* en `localhost:8091`. Así el backend no tiene URL
pública — más privado que protegerlo con IAM — y `FINANCIALBI_SERVICE_URL` sigue
apuntando a localhost igual que en el compose, sin tocar una línea de código. A
cambio escalan y se despliegan juntos. La alternativa (dos servicios con token de
identidad entre ellos) se descartó por no escribir ese código para una herramienta
interna de un solo cliente.

Artefactos en `deploy/cloudrun/`, con su propio README (preparación, despliegue y
cómo añadir un usuario técnico).

- [x] `service.yaml`, `cloudbuild.yaml`, `deploy.sh` y README escritos. Los
      sidecars solo se pueden describir en YAML: no valen los flags de
      `gcloud run deploy`.
- [x] `.gcloudignore` en la raíz. Sin él se subirían 618 MB al build, de los que
      549 MB son `node_modules` que la imagen reinstala igualmente.
- [x] `.htpasswd` resuelto: secreto de Secret Manager **montado como fichero** en
      `/etc/carb/.htpasswd`. `HTPASSWD_PATH` sigue valiendo sin tocar código, los
      hashes no viven en git y añadir un usuario no reconstruye imágenes.
- [x] `SESSION_SECRET` desde Secret Manager como variable de entorno.
- [x] `SESSION_COOKIE_SECURE=true`.
- [x] `--frozen-lockfile` en `Dockerfile.prod`.
- [x] Sin `BQ_CREDENTIALS_PATH`: `db.py` ya cae a credenciales de aplicación, así
      que el JSON de la service account no entra en la imagen. Salió gratis.
- [x] `FINANCIALBI_DB_BACKEND=bigquery` explícito. Matiz: hoy **no cambia nada**,
      porque la única función que consulta esa variable es `read_sql` y ningún
      motor la usa — todos importan `_get_bq_client` directamente. Se fija porque
      el valor por defecto en el código es `azure`.
- [x] `images.unoptimized` en `next.config.mjs`. En modo standalone `next/image`
      exige `sharp` o falla al optimizar; las únicas imágenes son el logo y el
      icono, PNG pequeños donde optimizar no aporta nada, así que se evita una
      dependencia nativa dentro de Alpine.
- [ ] Crear los secretos `carb-session-secret` y `carb-htpasswd` y dar
      `secretmanager.secretAccessor` a la identidad del servicio. Comandos en
      `deploy/cloudrun/README.md`.
- [ ] Ejecutar `bash deploy/cloudrun/deploy.sh`.
- [ ] Añadir la URL del servicio a los dominios autorizados de Firebase Auth, o el
      botón de Google falla con `auth/unauthorized-domain`.
- [ ] Probar con una cuenta real de cada rol.
- [ ] Rate limiting y registro de intentos fallidos en el login por `.htpasswd`.
- [ ] Revisar el TTL de sesión (hoy 8 h).
- [ ] Service account dedicada con permisos mínimos. Se despliega con
      `272166156031-compute@`, la misma que el resto del proyecto, que tiene rol
      *Editor*: mucho más de lo necesario. Aplazado por decisión, no por olvido.

**El dominio propio no bloquea nada**: se despliega sobre la URL `*.run.app` que
asigna Cloud Run y se añade esa a Firebase. El dominio definitivo se mapea después
sin tocar código, solo añadiéndolo también a Firebase.

`min-instances: 0`, así que la primera petición paga arranque en frío y el sidecar
carga pandas y pyarrow. Subirlo a 1 lo evita a cambio de pagar la instancia 24×7.

---

### Limpieza

- [x] Retirado el código muerto heredado: panel de perfil reducido a correo y rol,
      `db.py` a `get_bq_client()`, `src/lib/auth/jwt.ts` (decodificaba sin
      verificar), el despliegue en VM y 395 líneas de CSS huérfano. Fuera también
      las dependencias `mammoth` y `xlsx`.

Para saber si algo se usa en este repo, la autoridad es `tsc --noEmit` y no un
`grep`: hay componentes que se cargan con `import` dinámico y no aparecen en una
búsqueda de texto.

---

## 8. Pendiente de decidir

- **`admin` y `test@example.com` en el `.htpasswd`** son cuentas compartidas con
  rol gerencia, y cualquier aprobación queda firmada con ese nombre en BigQuery.
  Sustituirlas por cuentas nominales, o reducirlas a una de emergencia con
  contraseña fuerte. Lo mismo aplica al usuario `admin` del portal de listas, que
  es quien aparece como autor en el historial.
- **El nombre de la app en la pantalla de consentimiento es "Proan BigQuery"**, que
  es lo que ve un usuario al entrar en Hidrocarburos. Es del proyecto entero, pero
  las otras apps entran por contraseña y no ven esa pantalla.
- **A quién dirigir** a alguien que intenta entrar y no está en la lista.
- **Microsoft como segundo proveedor**, para que `@quantrue.com` entre sin
  contraseña. Con Firebase es un interruptor.

---

## 9. Fuera de alcance: blindar el portal de listas

Aplazado por decisión de Pablo, hoy único con acceso. Se anota porque desde que esa
lista reparte permisos, **quien entre ahí puede ponerse como gerencia en
Hidrocarburos**:

- Se despliega con `--allow-unauthenticated`, así que la URL la alcanza cualquiera
  y solo la protege su login, que no tiene límite de intentos. Quitar el flag no es
  la solución: sin token de IAM no entraría nadie desde un navegador. Lo correcto
  es poner **IAP** delante.
- No hay noción de administrador: cualquier usuario de `auth_users` puede editar
  cualquier lista.
- Los usuarios se crean con `create_or_update_user.py` (pasos en
  `proan-DBC/crearnuevousuariomailinglist.txt`). Escribe en Firestore, así que no
  necesita despliegue.

---

## 10. Verificación

Frontend: 43 tests (`apps/frontend/src/lib/auth/*.test.ts`, `vitest run`) sobre
firma de sesión, política de rutas, lista de acceso y claims de Google, más
`tsc --noEmit`. Backend de Mailing-lists: 24 comprobaciones de la lógica de datos
con un doble de Firestore, incluida la crítica — que los roles sobrevivan a un
guardado que no los envía.
