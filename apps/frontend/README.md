# Frontend React

`apps/frontend-react` es el nuevo frontend React/Next.js del producto. Sustituye
la UI legacy en Streamlit como nueva capa de presentacion, pero sin redisenar
el sistema de backend: la prioridad de esta migracion ha sido conservar el
mismo empalme funcional con autenticacion, gateway, permisos, documentos y
agentes que ya existian en la solucion anterior.

El objetivo no ha sido "hacer otro producto", sino mover la experiencia de
usuario desde Streamlit a una app web moderna manteniendo:

- los contratos backend ya vigentes
- la semantica de login y permisos
- la separacion entre chat general y chat por proyecto
- la dependencia operacional del gateway, ChatDocs, ChatBI y auth-service

## Objetivo y alcance

Este frontend cubre actualmente las superficies principales:

- login real contra LDAP
- sesion server-side con cookie HTTP-only
- bootstrap del usuario en gateway
- `/agent`
- `/projects`
- perfil de usuario
- `/admin`

No pretende cambiar por si mismo:

- los contratos HTTP del backend
- la logica RBAC central
- el pipeline de ingesta/documentos
- la orquestacion real del agente
- la semantica legacy de proyectos, hilos y documentos

En otras palabras: React cambia la capa de UI, pero el sistema de verdad sigue
estando en los servicios backend existentes.

## Resumen arquitectonico

La arquitectura real del frontend es esta:

```text
Browser
  -> Next.js App Router (`app/`)
  -> Route Handlers internos (`app/api/*`)
  -> auth-service / gateway / chatdocs / chatbi
  -> respuesta adaptada al cliente React
```

Hay dos ideas clave:

1. El cliente React no llama normalmente al gateway de forma directa.
2. La capa `app/api/*` actua como BFF ligero: valida sesion, adapta payloads,
   reenvia cabeceras, unifica errores y evita exponer la logica de integracion
   al navegador.

## Principios de la migracion desde Streamlit

La migracion ha seguido estos criterios:

- replicar el comportamiento funcional del frontend Streamlit siempre que fuera
  posible
- no introducir cambios de contrato en backend para "facilitar" la UI
- encapsular la integracion en Next.js en vez de repartirla por componentes
- separar base funcional comun y skin cliente
- conservar las dependencias legacy cuando son necesarias para no romper el
  sistema

Esto explica por que parte del frontend habla con `gateway`, pero algunos
flujos concretos siguen yendo a `chatdocs`, `chatbi` o `auth-service` desde
helpers server-side.

## Estructura de `apps/frontend-react`

### Vision general

La carpeta esta organizada en capas:

- `app/`
- `app/api/`
- `src/lib/`
- `src/features/`
- `src/components/`
- `src/skin/torrecid/`
- `src/types/`

La idea general es:

- `app/` define rutas y puntos de entrada de Next
- `app/api/` implementa el BFF interno
- `src/lib/` concentra integracion e infraestructura
- `src/features/` concentra logica funcional por dominio
- `src/components/` contiene piezas reutilizables transversales
- `src/skin/torrecid/` concentra branding y aspecto visual cliente
- `src/types/` fija contratos TS

### `app/`: rutas Next y paginas server-first

`app/` define las paginas y layouts del App Router.

Archivos y zonas clave:

- `app/page.tsx`
  Redirecciona a `/agent` o `/login` segun exista sesion.

- `app/layout.tsx`
  Layout raiz global de Next. Carga estilos globales base y la estructura
  comun del documento.

- `app/login/page.tsx`
  Punto de entrada de autenticacion. Renderiza el panel/login visual para el
  usuario anonimo.

- `app/(authenticated)/layout.tsx`
  Layout protegido. Recupera sesion, carga el usuario actual y monta la shell
  autenticada comun para todas las paginas internas.

- `app/(authenticated)/agent/page.tsx`
  Pagina del chat general. Resuelve server-side el hilo inicial, historial,
  usuario actual y agentes permitidos antes de hidratar la UI.

- `app/(authenticated)/projects/page.tsx`
  Pagina de proyectos. Carga proyectos y usuario autenticado y delega la
  experiencia completa en la feature correspondiente.

- `app/(authenticated)/admin/*`
  Superficie de administracion. Las paginas validan permisos y montan la UI de
  grupos, usuarios y roles.

El grupo `(authenticated)` no es una ruta visible; es una agrupacion de Next
para compartir layout protegido entre paginas privadas.

### `app/api/`: BFF interno y capa de proxy

`app/api/` es una de las piezas mas importantes del frontend. Aqui vive la
adaptacion entre la UI React y los servicios backend.

Responsabilidades de esta carpeta:

- leer la sesion HTTP-only del usuario
- rechazar peticiones anonimas
- normalizar payloads y parametros
- reenviar la peticion al servicio correcto
- adjuntar `Authorization` y `X-User-Id` cuando toca
- devolver errores coherentes a la UI
- ocultar al navegador la topologia real de servicios

Subareas principales:

- `app/api/auth/*`
  Login y logout.

- `app/api/agent/*`
  Hilos, mensajes, stream SSE, autotitulado y documentos temporales de chat.

- `app/api/projects/*`
  CRUD de proyectos, miembros, sharing, descripcion, instrucciones y
  documentos.

- `app/api/admin/*`
  Operaciones de administracion expuestas al frontend.

- `app/api/profile/*`
  Datos auxiliares del perfil como esquemas accesibles y documentos
  permanentes.

- `app/api/pdf/*`
  Proxy para abrir PDFs persistentes o temporales sin exponer al cliente las
  rutas reales aguas abajo.

- `app/api/users/me/instructions`
  Guardado de instrucciones de usuario.

### `src/lib/`: integracion, sesion e infraestructura

`src/lib/` contiene la logica de infraestructura usada por paginas y route
handlers.

Archivos clave:

- `src/lib/env.ts`
  Centraliza lectura de variables de entorno y defaults. Es la fuente de
  verdad para URLs de upstream y configuracion de cookie.

- `src/lib/auth/session.ts`
  Gestiona la sesion del frontend en cookie HTTP-only. Codifica/decodifica el
  payload y ofrece `getSession`, `requireSession`, `setSession` y
  `clearSession`.

- `src/lib/auth/jwt.ts`
  Utilidad para decodificar claims del JWT devuelto por auth-service y extraer
  `apps`, `sub` y expiracion.

- `src/lib/gateway.ts`
  Cliente server-side principal contra gateway. Implementa fetches para
  usuarios, proyectos, hilos, mensajes, SSE del agente, GPT-only y
  autotitulado. Tambien contiene la llamada directa al endpoint LLM compatible
  para resumir titulos antes de persistirlos en gateway.

- `src/lib/profile.ts`
  Helpers server-side del perfil. Aqui hay una excepcion consciente al patron
  "todo pasa por gateway": algunas consultas siguen yendo directamente a
  `chatbi` y `chatdocs` porque el sistema legacy ya las resuelve alli.

- `src/lib/admin.ts`
  Capa mas compleja de integracion administrativa. Mezcla:
  - lectura/escritura de ficheros de configuracion
  - parseo de reglas Polar
  - llamadas al backend de auth/admin
  - descubrimiento de carpetas/documentos
  - disparo del watcher de sincronizacion

  Esto significa que el modulo Admin de React no es solo un cliente HTTP: hace
  tambien de capa operativa y de adaptacion a la configuracion local del
  entorno.

- `src/lib/temp-docs.ts`
  Integracion con ChatDocs para subir y borrar documentos temporales ligados a
  un hilo.

- `src/lib/chatbi-temp-docs.ts`
  Integracion especifica con ChatBI para sus documentos temporales.

### `src/features/`: logica funcional por dominio

Aqui vive la mayor parte de la UI con estado y comportamiento de negocio del
frontend.

#### `src/features/agent/`

Contiene la experiencia de chat general.

- `agent-workspace.tsx`
  Componente principal de la pantalla `/agent`. Orquesta:
  - lista de hilos
  - creacion/seleccion/borrado/renombrado
  - carga de historial
  - envio de prompts
  - streaming SSE
  - render de reasoning y Plotly
  - subida de documentos temporales
  - persistencia local de artefactos por hilo

- `agent-thread-client.ts`
  Cliente del lado navegador contra los route handlers de hilos y stream.

- `agent-stream.ts`
  Parseo del stream SSE del agente y utilidades asociadas.

- `agent-conversation-state.ts`
  Reconciliacion del estado conversacional y de artefactos recibidos.

- `agent-artifact-storage.ts`
  Persistencia local de artefactos de conversacion.

- `plotly-chart.tsx`
  Render diferido de graficos Plotly generados por el agente.

- `*.test.ts`
  Tests de helpers puros relacionados con stream, estado y almacenamiento.

#### `src/features/projects/`

Contiene la experiencia de trabajo por proyecto.

- `projects-workspace.tsx`
  Shell funcional de `/projects`. Gestiona listado, seleccion, creacion,
  borrado y navegacion de proyectos, asi como el empalme con el workspace
  conversacional del proyecto.

- `project-chat-workspace.tsx`
  Chat contextual de proyecto. Mantiene la separacion semantica respecto a
  `/agent`: aqui el hilo opera con `project_id` y con el contexto del proyecto.

- `project-documents-panel.tsx`
  Gestiona documentos del proyecto: listar, subir, borrar y abrir PDFs.

- `project-members-panel.tsx`
  Gestiona miembros y sharing por email.

#### `src/features/admin/`

- `admin-workspace.tsx`
  UI principal de administracion. Unifica formularios, tablas y acciones para
  grupos, usuarios, roles y sincronizacion de vectorstore.

### `src/components/`: componentes reutilizables

Aqui van piezas compartidas entre features.

- `login-form.tsx`
  Formulario de login contra `POST /api/auth/login`.

- `logout-button.tsx`
  Dispara el cierre de sesion contra `POST /api/auth/logout`.

- `profile-panel.tsx`
  Panel lateral/modal de perfil. Permite ver usuario, editar instrucciones y
  consultar informacion adicional.

- `pdf-viewer-modal.tsx`
  Modal comun para visualizar PDFs embebidos.

- `pdf-linked-message.tsx`
  Interpreta referencias a documentos dentro de mensajes y construye la URL
  correcta del proxy PDF interno.

### `src/skin/torrecid/`: skin cliente

Esta carpeta concentra todo lo especifico de Torrecid.

- `branding/`
  Textos visibles de marca y naming de navegacion.

- `components/torrecid-login-panel.tsx`
  Presentacion visual del login.

- `components/torrecid-authenticated-shell.tsx`
  Shell visual autenticada: topbar, navegacion, apertura de perfil y logout.

- `theme/globals.css`
  Estilos principales de la skin y de componentes visuales.

- `assets/logos/*`
  Logos e iconografia cliente.

La intencion es que la logica funcional no viva aqui. Esta capa deberia
concentrar branding, layout visual y decisiones de presentacion.

### `src/types/`: contratos TypeScript

Tipos compartidos del frontend.

- `auth.ts`
  Tipos de sesion frontend y login.

- `gateway.ts`
  Tipos para usuarios, proyectos, hilos, mensajes, stream, documentos y
  respuestas del gateway.

- `admin.ts`
  Tipos propios de la superficie de administracion.

- `plotly-modules.d.ts`
  Declaraciones para modulos Plotly sin tipado nativo adecuado.

## Rutas funcionales principales

### `/login`

Responsabilidad:

- autenticar al usuario contra LDAP mediante auth-service
- bootstrapear el usuario en gateway
- crear la cookie de sesion HTTP-only del frontend
- redirigir a `/agent`

Piezas clave:

- `app/login/page.tsx`
- `src/components/login-form.tsx`
- `app/api/auth/login/route.ts`

### `/agent`

Es el chat general del producto, sin contexto de proyecto.

Comportamientos implementados:

- obtener agentes permitidos desde gateway
- listar hilos `gpt`
- crear hilo inicial si no existe
- reutilizar el ultimo hilo vacio cuando corresponde
- cargar historial real
- enviar prompts por SSE a `POST /v1/agent/stream`
- mostrar reasoning cuando llega el sentinel de thinking
- mostrar `plotly_spec`
- renombrar y borrar hilos
- persistir artefactos conversacionales localmente
- soportar documentos temporales

Archivos principales:

- `app/(authenticated)/agent/page.tsx`
- `src/features/agent/agent-workspace.tsx`
- `app/api/agent/stream/route.ts`
- `app/api/agent/threads/*`

### `/projects`

Es la superficie de trabajo por proyecto.

Comportamientos implementados:

- listar proyectos visibles para el usuario
- crear proyecto
- seleccionar proyecto mediante `?projectId=...`
- mantener chat ligado a `project_id`
- editar descripcion
- editar instrucciones globales
- listar/subir/borrar documentos
- listar miembros
- compartir proyecto por email
- eliminar proyecto o salir de el segun rol backend

Importante:

- `/projects` no es una copia exacta de `/agent`
- el contexto conversacional esta ligado al proyecto
- la semantica de permisos y sharing sigue delegada en gateway

### Perfil

El perfil vive dentro de la shell autenticada, no como pagina separada.

Funciones principales:

- mostrar identidad del usuario autenticado
- editar `user_instructions`
- consultar esquemas accesibles
- consultar documentos permanentes
- abrir PDFs asociados

Piezas clave:

- `src/components/profile-panel.tsx`
- `app/api/profile/*`
- `app/api/users/me/instructions/route.ts`

### `/admin`

La administracion React cubre:

- grupos
- usuarios
- roles
- lanzamiento de sincronizacion de vectorstore

Dependencias reales:

- auth-service para operaciones de politica/usuarios
- ficheros locales de configuracion de grupos/roles
- reglas Polar
- watcher para sincronizacion

Es la zona menos "frontend puro" del proyecto, porque encapsula bastante
adaptacion operacional del entorno.

## Flujo de autenticacion y sesion

El flujo real es este:

1. El usuario envia credenciales a `POST /api/auth/login`.
2. El route handler de Next llama a `AUTH_LOGIN_URL`.
3. auth-service devuelve un JWT y datos basicos del usuario.
4. Next decodifica claims del JWT.
5. Next llama a `POST /v1/users/ensure` en gateway para garantizar que existe
   el usuario canonico del sistema.
6. Next guarda una sesion propia en cookie HTTP-only con:
   - token JWT
   - email
   - username/display name
   - `gatewayUserId`
   - apps permitidas
   - subject
   - expiracion
7. El resto de pantallas y route handlers operan a partir de esa cookie.

Consecuencias de este diseño:

- el navegador no necesita conocer la topologia completa backend
- la UI no manipula directamente el JWT en localStorage
- el servidor de Next puede hacer fetch server-side autenticado
- la sesion del frontend contiene tambien el `user_id` canonico del gateway

## Capa BFF: por que `app/api/*` existe

La carpeta `app/api/*` no es decorativa. Es el punto de union entre React y el
backend real.

Ventajas que aporta:

- evita repetir auth en el cliente
- centraliza normalizacion de errores
- desacopla los componentes de URLs y cabeceras backend
- permite mezclar varios upstreams sin exponerlos al navegador
- facilita preservar contratos legacy mientras evoluciona la UI

Regla practica:

- para operaciones normales, el cliente habla con `/api/*`
- el BFF interno decide si reenvia a gateway, auth-service, chatdocs o chatbi

## Integracion con backend y contratos preservados

### Gateway como backend principal

El gateway sigue siendo el backend principal del frontend React. Desde aqui se
resuelven sobre todo:

- usuario actual
- instrucciones de usuario
- agentes permitidos
- proyectos
- miembros
- sharing
- hilos
- mensajes
- stream del agente
- titulos de hilos
- modo GPT-only
- documentos persistentes de proyecto
- PDF fuente servido por gateway

Contratos especialmente relevantes:

- `POST /v1/users/ensure`
- `GET /v1/users/me`
- `PATCH /v1/users/me/instructions`
- `GET /v1/agent/tools`
- `POST /v1/agent/stream`
- `GET /v1/threads?tool=gpt`
- `GET /v1/threads?tool=gpt&project_id=...`
- `POST /v1/threads`
- `GET /v1/threads/{thread_id}/messages`
- `PATCH /v1/threads/{thread_id}/title`
- `DELETE /v1/threads/{thread_id}`
- `POST /v1/threads/{thread_id}/gpt-only`
- `DELETE /v1/threads/{thread_id}/gpt-only`
- `GET /v1/projects`
- `POST /v1/projects`
- `DELETE /v1/projects/{project_id}`
- `PATCH /v1/projects/{project_id}/description`
- `PATCH /v1/projects/{project_id}/instructions`
- `GET /v1/projects/{project_id}/documents`
- `POST /v1/projects/{project_id}/documents/upload`
- `DELETE /v1/projects/{project_id}/documents/{doc_id}`
- `GET /v1/projects/{project_id}/members`
- `POST /v1/projects/{project_id}/fork`
- `DELETE /v1/projects/{project_id}/members/{member_user_id}`
- `GET /v1/pdf/source`

### Auth-service

Se usa principalmente para:

- login LDAP (`/ldap-login`)
- operaciones internas de administracion

No es el backend principal de la app, pero es critico en autenticacion y
admin.

### ChatDocs

Se usa en flujos concretos:

- documentos temporales del agente
- consulta de documentos permanentes del perfil
- recuperacion de PDFs temporales

### ChatBI

Se usa en flujos concretos:

- sesion inicial de ChatBI para documentos temporales de ese dominio
- subida/borrado de docs temporales propios de ChatBI
- consulta de esquemas accesibles del perfil

## Flujos especiales que el README debe dejar fijados

### 1. Login LDAP y bootstrap de usuario

No basta con autenticar contra LDAP. El frontend necesita ademas resolver el
usuario canonico del gateway para poder operar con `X-User-Id`.

Por eso el login real tiene dos pasos:

- auth-service autentica y devuelve JWT
- gateway garantiza/crea el usuario interno

### 2. Streaming SSE del agente

`/agent` y el chat por proyecto usan streaming SSE real a traves del route
handler `app/api/agent/stream/route.ts`, que reenvia a
`POST /v1/agent/stream`.

El frontend interpreta eventos para:

- texto incremental
- thinking/reasoning
- plotly
- cierre de stream
- errores

### 3. Autotitulado de hilos

El autotitulado no lo hace gateway.

Flujo real:

1. el frontend llama a `PATCH /api/agent/threads/[threadId]/title`
2. si recibe `prompt`, el handler invoca un endpoint LLM compatible en
   `LLM_API_URL`
3. el frontend resume el titulo
4. despues persiste el titulo en gateway con `PATCH /v1/threads/{thread_id}/title`

Esto replica el patron que ya existia en la solucion legacy.

### 4. Documentos temporales y modo GPT-only

Cuando se suben documentos temporales para un hilo del agente:

- Next los reenvia a ChatDocs
- intenta marcar el hilo como GPT-only en gateway

Cuando se borran:

- Next ordena el borrado en ChatDocs
- intenta limpiar el flag GPT-only en gateway

Esto alinea la UI con la restriccion backend de agentes disponibles cuando hay
documentacion temporal asociada.

### 5. Visualizacion y proxy de PDFs

El frontend no incrusta rutas backend arbitrarias directamente.

Hay dos proxies:

- `app/api/pdf/source/route.ts`
  Para PDFs persistentes obtenidos via gateway.

- `app/api/pdf/temp/route.ts`
  Para PDFs temporales obtenidos via ChatDocs.

`pdf-linked-message.tsx` y los paneles de perfil/proyecto construyen las URLs
internas correctas para abrir el documento.

### 6. Separacion entre chat general y proyectos

Esta separacion es deliberada y replica la semantica funcional previa:

- `/agent` representa chat general, sin `project_id`
- `/projects` representa trabajo contextualizado por proyecto
- los hilos de proyecto usan `project_id`
- los permisos, documentos y miembros del proyecto se resuelven en backend

## Relacion con el frontend Streamlit legacy

### Lo que se ha replicado fielmente

- login real con backend existente
- bootstrap de usuario
- chat general con hilos reales
- streaming SSE del agente
- razonamiento visible
- render de Plotly
- gestion de proyectos
- documentos de proyecto
- sharing basico de proyectos
- perfil con instrucciones de usuario
- administracion base

### Lo que se ha separado intencionadamente en React

- la UI se organiza por rutas y features, no por paginas Streamlit
- el empalme con backend vive en route handlers y helpers server-side
- la shell autenticada es comun y reutilizable
- la skin cliente queda aislada de la base funcional

### Lo que sigue dependiendo del sistema legacy/backend

- permisos reales por JWT/apps
- creacion usable de proyectos, que depende de infraestructura backend
- procesamiento de documentos
- disponibilidad de reasoning/Plotly
- datos de perfil como esquemas y documentos permanentes
- operaciones administrativas ligadas a ficheros/politicas/watcher

## Cambios fuera de `frontend-react` necesarios para soportar React

### `apps/gateway/gateway/main.py`

El gateway no se reescribio para React, pero sigue proporcionando el contrato
que la nueva UI necesita preservar:

- usuarios y bootstrap
- proyectos y miembros
- hilos y mensajes
- stream del agente
- herramientas/agentes permitidos
- flags GPT-only
- documentos de proyecto y PDF fuente

El README debe asumir que React depende de estos endpoints y de su semantica
actual, no de una API nueva pensada especificamente para Next.js.

### `deploy/docker-compose.dev.yml`

Se anade el servicio `frontend-react-dev`:

- construye desde `apps/frontend-react/Dockerfile`
- expone internamente el puerto `3000`
- publica `3100:3000` para acceso directo en desarrollo
- monta `app/`, `src/` y ficheros de configuracion para hot reload
- define variables de entorno de auth, gateway, LLM y cookie

Convive todavia con `streamlit-dev`, lo que deja claro que la migracion React
ha necesitado convivencia temporal con la app legacy.

### `deploy/nginx/nginx.dev.conf`

Nginx de desarrollo cambia su ruta principal para apuntar al frontend React:

- `location /` proxya a `frontend-react-dev:3000`
- `location = /api/auth/login` se deja publico y proxya tambien a React

Al mismo tiempo, se mantiene soporte residual para piezas legacy de Streamlit:

- rewrites de rutas historicas
- soporte para `/_stcore/*`
- soporte para assets de componentes Streamlit

Esto refleja el estado real de la migracion: React es ya el frontend principal
de desarrollo, pero todavia hay compatibilidad operativa con elementos legacy.

## Entorno local y desarrollo

### Scripts del proyecto

Segun `package.json`:

```bash
corepack pnpm dev
pnpm build
pnpm start
pnpm lint
pnpm test
```

`vitest` cubre tests de helpers puros, no un e2e completo de la aplicacion.

### Ejecucion local tipica

Flujo habitual:

```bash
cd apps/frontend-react
corepack pnpm install
corepack pnpm dev
```

Por defecto:

- Next corre en `http://localhost:3000`
- en Compose dev el servicio publica `http://localhost:3100`

### Dockerfile

`apps/frontend-react/Dockerfile`:

- parte de `node:20-alpine`
- habilita `corepack`
- instala dependencias via `pnpm`
- copia `app/`, `src/` y configs
- expone `3000`
- arranca `pnpm dev`

Es una dockerizacion de desarrollo. No representa aun un empaquetado final de
produccion.

## Variables de entorno

Variables principales usadas por el frontend:

- `AUTH_LOGIN_URL`
  URL exacta del login LDAP aguas arriba.

- `AUTH_SERVICE_BASE_URL`
  Base URL del auth-service para operaciones administrativas.

- `GATEWAY_BASE_URL`
  Base URL del gateway principal.

- `CHATBI_BASE_URL`
  Base URL de ChatBI para helpers especificos.

- `CHATDOCS_BASE_URL`
  Base URL de ChatDocs para docs temporales, docs permanentes y PDFs
  temporales.

- `LLM_API_URL`
  Endpoint compatible para autotitulado.

- `LLM_MODEL_ID`
  Modelo usado por el autotitulado.

- `SESSION_COOKIE_NAME`
  Nombre de la cookie HTTP-only de sesion del frontend.

- `SESSION_COOKIE_SECURE`
  Indica si la cookie debe emitirse como `Secure`.

Valores por defecto codificados en `src/lib/env.ts`:

```bash
AUTH_LOGIN_URL=http://localhost:8090/ldap-login
AUTH_SERVICE_BASE_URL=http://localhost:8090
GATEWAY_BASE_URL=http://localhost:8000
CHATBI_BASE_URL=http://localhost:8080
CHATDOCS_BASE_URL=http://localhost:8081
LLM_API_URL=http://apolo.torrecid.com:8010/v1
LLM_MODEL_ID=google/gemma-4-31B-it
SESSION_COOKIE_NAME=aitor_frontend_react_session
SESSION_COOKIE_SECURE=false
```

Importante:

- no documentar aqui secretos ni contenidos reales de `.env.local`
- los defaults son utiles para entender el codigo, no para asumir que el
  entorno real siempre coincide con ellos

## Ficheros relevantes de configuracion local

- `package.json`
  Dependencias y scripts.

- `pnpm-lock.yaml`
  Lockfile de dependencias.

- `tsconfig.json`
  Configuracion TypeScript y alias `@/* -> ./src/*`.

- `next.config.mjs`
  Configuracion minima de Next. Actualmente solo activa `reactStrictMode`.

- `vitest.config.ts`
  Configuracion de tests unitarios.

- `.eslintrc.json`
  Reglas de lint del frontend.

- `next-env.d.ts`
  Tipos generados/esperados por Next.

- `Dockerfile`
  Imagen de desarrollo del frontend.

## Artefactos ignorados y locales

`.gitignore` de `apps/frontend-react` excluye:

- `node_modules`
  Dependencias instaladas localmente.

- `.next`
  Build output y cache de Next.

- `dist`
  Artefactos de build adicionales.

- `coverage`
  Salida de cobertura de tests.

- `.env.local`
  Configuracion local del desarrollador.

- `Dockerizacion.md`
  Documento auxiliar/no canonico de dockerizacion.

Estos ficheros y carpetas pueden existir en el working tree local, pero no son
parte del codigo fuente versionado que define el frontend.

## Decisiones de diseño importantes

- El frontend usa Next App Router y mezcla render server-side con componentes
  cliente cuando hace falta estado interactivo.

- La sesion del frontend se guarda en cookie HTTP-only, no en localStorage.

- `app/api/*` es una capa deliberada y necesaria, no un duplicado innecesario
  de endpoints.

- La skin Torrecid se intenta mantener separada de la base funcional.

- Admin sigue siendo una zona fuertemente acoplada al entorno real del sistema.

- Algunos flujos siguen hablando directamente con `chatdocs` o `chatbi` desde
  helpers server-side porque asi funciona hoy el backend disponible.

## Limitaciones y pendientes

Estado actual y limites conocidos:

- la app React ya cubre el nucleo principal, pero no implica que toda la
  infraestructura legacy haya desaparecido
- la dockerizacion del frontend sigue orientada a desarrollo
- varias operaciones dependen de que gateway, auth-service, ChatDocs, ChatBI,
  watcher y documentos esten correctamente montados
- la disponibilidad real de reasoning, Plotly y procesamiento documental no
  depende solo de la UI
- Admin mantiene acoplamientos operativos que en el futuro podrian separarse
  mejor
- Nginx dev conserva compatibilidad residual con piezas Streamlit legacy

Pendientes razonables a medio plazo:

- endurecer la separacion entre base comun y skin cliente
- simplificar la capa Admin
- definir una dockerizacion final del frontend React
- reducir la compatibilidad residual necesaria con Streamlit en desarrollo

## Lectura rapida para nuevos desarrolladores

Si necesitas orientarte rapido en esta carpeta:

1. Empieza por `app/(authenticated)/agent/page.tsx` y
   `src/features/agent/agent-workspace.tsx` para entender el flujo principal.
2. Revisa `app/api/agent/*` y `src/lib/gateway.ts` para ver como se empalma con
   backend.
3. Revisa `src/lib/auth/session.ts` y `app/api/auth/login/route.ts` para
   entender autenticacion y sesion.
4. Revisa `src/features/projects/*` para el flujo por proyecto.
5. Revisa `src/lib/admin.ts` si vas a tocar administracion, porque ahi vive gran
   parte de la logica no obvia del sistema.

Ese recorrido refleja bastante bien como esta construida hoy la app.
