# proan-Hidrocarburos

Herramienta de gestión de **facturas de gas** (clasificación, validación SAP y
aprobación) para Proteína Animal — ver [Qué hace la herramienta](#qué-hace-la-herramienta).
Nace como derivado de `proan-maka-rentabilidad` (de ahí el esqueleto de
reportes + alertas, sin agentes ni chat) y mantiene su estructura tipo
monorepo (como Maka, pero recortado):

```
apps/financialbi   backend FastAPI (BigQuery)
apps/frontend      frontend Next.js 14 (Hidrocarburos, estética Proan)
deploy/cloudrun    despliegue de producción (Cloud Run)
deploy/            docker-compose.dev.yml + nginx (solo desarrollo)
config/            financialbi.env + bq_credentials.json (BigQuery)
pyproject.toml     workspace uv (miembro: apps/financialbi) + uv.lock
LOGIN.md           decisiones y estado del login y los roles
```

- **Backend**: endpoints `/v1/financialbi/hidrocarburos/{catalog,summary,invoices/search,invoices/{uuid}}`.
  El código Maka original (reportes/alertas con Gemini) se eliminó — no
  aplicaba a este producto; ver historial de git si hace falta consultarlo.
- **Frontend**: dos vías de login que emiten la misma cookie de sesión firmada —
  **Google** (Firebase Authentication) y **usuario/contraseña** contra
  `.htpasswd` (bcrypt) —, ambas verificadas dentro del propio Next, sin
  auth-service ni gateway. Dos roles: `gerencia` y `generico`. Ver
  [`LOGIN.md`](./LOGIN.md). **nginx** solo interviene en desarrollo, como
  reverse-proxy; en producción Cloud Run termina el TLS y enruta.

## Qué hace la herramienta

Gestiona el ciclo de vida de las **facturas de gas** (CFDI) de Proteína Animal
desde que llegan hasta que se aprueban para pago: las clasifica, comprueba si
SAP las tiene registradas, y las hace pasar por una validación de Compras y
una aprobación de Gerencia. No es un ERP ni sustituye a SAP — es una capa de
revisión y control sobre datos que ya existen en BigQuery.

**Alcance actual (provisional, pendiente de ratificar con negocio):** solo
facturas recibidas por Proteína Animal (`PAN921013AK7`) con clave SAT de gas
(propano, natural, GNL, GNC, butano — `151115xx`) o servicio de GNC
(`83101600`/`83101601`), **desde 2026-01-01** (D31 — alineado con la cobertura
real de SAP/MSEG, que solo tiene datos de 2026). Diésel y gasolina quedan
fuera. ~547 facturas, ~$25.9M, 11 proveedores.

### Módulos

| Módulo | Qué hace | Estado |
| --- | --- | --- |
| **M1 — Clasificación** | Filtra las facturas de gas del CFDI, marca las mixtas (factura con gas + otros conceptos) y calcula el importe de gas por factura (nunca el total de la factura, que puede incluir otras cosas). | ✅ Construido |
| **M2 — Validación SAP** (automática) | Comprueba si la factura quedó registrada en la contabilidad de SAP (~91% lo está) y, cuando es posible, deriva la planta de consumo a partir del pedido de compra (~70% de los casos). No bloquea nada — es información de contexto. | ✅ Construido |
| **M3 — Aprobación** | Flujo de dos pasos humanos: **Compras** revisa la factura, indica el centro de costos (CECO, siempre manual) y confirma/corrige la planta de consumo si M2 no la dedujo; **Gerencia** ve la factura ya revisada por Compras y la aprueba o rechaza. Reversible: se puede corregir o "reabrir" una decisión. | ✅ Construido |
| **M4 — Pago** | Marcar la factura como pagada una vez SAP procese el pago. | ⏸️ Aparcado — no existe hoy una fuente de datos fiable del estatus de pago por proveedor |
| **Estatus SAT** | Comprueba si el CFDI sigue vigente o fue cancelado ante el SAT (webservice público). | ✅ Construido — corre a mano (`python -m financialbi.estatus_sat`) hasta que exista el DAG de Airflow |
| **Dashboard** | Resumen de estatus (total/pendientes/validadas/aprobadas/rechazadas + estatus SAT) y gasto por CECO/sitio/periodo. | ✅ Construido |

### Lo que un usuario ve y puede hacer

- **Portal de facturas (M1+M2):** una tabla con todas las facturas de gas
  detectadas, filtrable por proveedor, fecha, planta y si SAP la validó o no.
  Al abrir una factura se ve su desglose (importe de gas, si es mixta, estado
  de registro en SAP, planta si se conoce).
- **Cola de Compras (M3):** facturas pendientes de revisar. Compras captura
  el CECO (siempre a mano — no hay forma de derivarlo automáticamente de los
  datos de SAP disponibles) y confirma la planta si M2 no la dedujo, con
  sugerencias desde catálogos conocidos pero sin bloquear si el dato correcto
  no aparece en la lista.
- **Cola de Gerencia (M3):** facturas ya revisadas por Compras, con un botón
  de aprobar/rechazar tipo "one-tap".
- **Historial (M3):** facturas ya enviadas a Gerencia o ya decididas —
  permite corregir CECO/sitio antes de que Gerencia decida, o "reabrir" una
  factura aprobada/rechazada por error (vuelve a pendiente de Compras).
- **Dashboard:** resumen ejecutivo de estatus y gasto — ver arriba.

### Limitaciones conocidas (no son bugs, son la realidad de los datos)

- El **CECO siempre se captura a mano** — no existe en ninguna tabla de SAP
  disponible la imputación de centro de costos por factura de gas.
- La **planta de consumo** solo se deduce automáticamente para ~70% de las
  facturas (el resto no tiene rastro de pedido con recepción en SAP) — el
  resto se captura a mano en M3.
- **No hay dirección postal/geográfica** de las plantas, solo el nombre de la
  sede.
- El **estatus de pago (M4) no es recuperable** de los datos actuales — se
  necesitaría una fuente de SAP que hoy no está disponible en el almacén.
- El **estatus de cancelación ante el SAT** se comprueba contra el webservice
  público del SAT (no viene en los datos de CFDI) — construido, pero corre a
  mano hasta que exista el DAG de Airflow.
- **Reabrir una decisión lo puede hacer cualquier rol**, también el genérico: es
  una decisión explícita, no un olvido. Lo que el rol genérico no puede es
  aceptar ni rechazar facturas.

El SQL de producto que construye las tablas `HCARB_*` está en git, en
[`ConsultasBigQuery/`](./ConsultasBigQuery/) — ahí también el historial de
bugs corregidos al ejecutarlo contra BigQuery real. Por qué el cruce
CFDI↔SAP nunca es exacto al 100% (grano distinto entre sistemas, CECO/sitio
como evidencia y no como dato exacto) en
[`Datos/naturaleza-de-los-datos.md`](./Datos/naturaleza-de-los-datos.md).

## Levantar en local (desarrollo)

Requisitos: Docker Desktop. Desde la **raíz del repo**:

1. **Credenciales BigQuery** — service-account (lectura sobre `proan-quantrue`) en:

   ```
   config/bq_credentials.json
   ```

2. **Arrancar**

   ```bash
   docker compose -f deploy/docker-compose.dev.yml up --build
   ```

3. Abre **http://localhost:8080** y entra por una de las dos vías:

   - **Entrar con Google**, con una cuenta `@proan.com` que esté en la lista de
     acceso. El compose de desarrollo ya trae la configuración de Firebase y
     monta las credenciales de GCP para poder leer esa lista.
   - **Acceso para desarrolladores** (desplegable al pie del login): usuario y
     contraseña del `.htpasswd`, siempre con rol `gerencia`.

Se levantan **3 contenedores**: `carb-nginx-dev`, `carb-frontend-dev`,
`carb-financialbi-dev`. Sin volúmenes con nombre (solo bind-mounts).

## Usuarios

Hay dos poblaciones distintas y se gestionan en sitios distintos:

- **Usuarios de la herramienta** (entran con Google): en una lista de Firestore,
  desde el portal de listas de `proan-DBC/Mailing-lists`. Ahí se les asigna el
  rol. No requiere desplegar nada.
- **Acceso técnico** (usuario y contraseña): en el `.htpasswd`, siempre con rol
  `gerencia`. En producción ese fichero llega desde Secret Manager, ver
  [`deploy/cloudrun/README.md`](./deploy/cloudrun/README.md).

Detalle de las dos vías, los roles y cómo dar acceso: [`LOGIN.md`](./LOGIN.md).

### .htpasswd en desarrollo

Vive en `deploy/nginx/.htpasswd` (`usuario:hash-bcrypt`). Para añadir/cambiar:

```bash
htpasswd -B deploy/nginx/.htpasswd otrousuario        # si tienes apache2-utils
```

O sin instalar nada, con el contenedor del frontend (bcryptjs ya incluido):

```bash
docker compose -f deploy/docker-compose.dev.yml run --rm --no-deps carb-frontend-dev \
  node -e "import('bcryptjs').then(b=>console.log(process.argv[1]+':'+b.default.hashSync(process.argv[2],12)))" \
  otrousuario suClave
# pega la línea resultante en deploy/nginx/.htpasswd
```

El fichero se monta en caliente: cambios sin rebuild (re-login).

## Dependencias del backend (uv)

El backend usa un **workspace uv**: `pyproject.toml` + `uv.lock` en la raíz. Tras
cambiar dependencias en `apps/financialbi/pyproject.toml`, regenera el lock:

```bash
# uv no hace falta instalarlo en el host; se usa vía contenedor.
# OJO: la variante ":latest" es una imagen mínima pensada solo para
# "COPY --from=... /uv" dentro de un Dockerfile (así la usan los Dockerfile
# de este repo) -- no trae ni siquiera /bin/sh, así que corrida standalone
# falla con "Failed to discover managed Python installations". Para correrla
# suelta hace falta la variante con Python + Debian incluidos:
docker run --rm -v "${PWD}:/w" -w /w ghcr.io/astral-sh/uv:python3.11-bookworm-slim uv lock
```

## Producción / despliegue

**Cloud Run**, con `bash deploy/cloudrun/deploy.sh`. Ver
[deploy/cloudrun/README.md](deploy/cloudrun/README.md) para la preparación
(secretos) y el detalle.

Es **un solo servicio con dos contenedores**: el frontend Next.js como entrada y
`financialbi` como sidecar en `localhost:8091`. El backend no tiene URL pública,
así que no hay autenticación entre servicios que mantener, y
`FINANCIALBI_SERVICE_URL` sigue apuntando a localhost igual que en desarrollo.
No hay nginx: Cloud Run termina el TLS y enruta.

Las tablas `HCARB_*` que lee el backend se construyen con `ConsultasBigQuery/`
(hoy a mano; la versión orquestable con Airflow vive en paralelo en `Airflow/`),
no con un Cloud Run Job propio del backend. El único Cloud Run Job hoy es
`hcarb-estatus-sat` (`Airflow/HCARB_ESTATUS_SAT/`, estatus SAT).

