# proan-Hidrocarburos

Herramienta de gestión de **facturas de gas** (clasificación, validación SAP y
aprobación) para Proteína Animal — ver [Qué hace la herramienta](#qué-hace-la-herramienta).
Nace como derivado de `proan-maka-rentabilidad` (de ahí el esqueleto de
reportes + alertas, sin agentes ni chat) y mantiene su estructura tipo
monorepo (como Maka, pero recortado):

```
apps/financialbi   backend FastAPI (BigQuery)
apps/frontend      frontend Next.js 14 (Hidrocarburos, estética Proan)
deploy/            docker-compose (dev/prod) + nginx
config/            financialbi.env + bq_credentials.json (BigQuery)
pyproject.toml     workspace uv (miembro: apps/financialbi) + uv.lock
```

- **Backend**: endpoints `/v1/financialbi/hidrocarburos/{catalog,summary,invoices/search,invoices/{uuid}}`.
  El código Maka original (reportes/alertas con Gemini) se eliminó — no
  aplicaba a este producto; ver historial de git si hace falta consultarlo.
- **Frontend**: autenticación por **`.htpasswd`** (bcrypt), verificada dentro del
  propio Next (sin auth-service ni gateway). **nginx** delante hace solo de
  reverse-proxy (igual que con el frontend-react de Maka).

## Qué hace la herramienta

Gestiona el ciclo de vida de las **facturas de gas** (CFDI) de Proteína Animal
desde que llegan hasta que se aprueban para pago: las clasifica, comprueba si
SAP las tiene registradas, y las hace pasar por una validación de Compras y
una aprobación de Gerencia. No es un ERP ni sustituye a SAP — es una capa de
revisión y control sobre datos que ya existen en BigQuery.

**Alcance actual (provisional, pendiente de ratificar con negocio):** solo
facturas recibidas por Proteína Animal (`PAN921013AK7`) con clave SAT de gas
(propano, natural, GNL, GNC, butano — `151115xx`) o servicio de GNC
(`83101600`/`83101601`). Diésel y gasolina quedan fuera. ~1.051 facturas,
~$40M, 11 proveedores, sobre el histórico cargado hasta la fecha.

### Módulos

| Módulo | Qué hace | Estado |
| --- | --- | --- |
| **M1 — Clasificación** | Filtra las facturas de gas del CFDI, marca las mixtas (factura con gas + otros conceptos) y calcula el importe de gas por factura (nunca el total de la factura, que puede incluir otras cosas). | ✅ Construido |
| **M2 — Validación SAP** (automática) | Comprueba si la factura quedó registrada en la contabilidad de SAP (~85% lo está) y, cuando es posible, deriva la planta de consumo a partir del pedido de compra (~54-58% de los casos). No bloquea nada — es información de contexto. | ✅ Construido |
| **M3 — Aprobación** | Flujo de dos pasos humanos: **Compras** revisa la factura, indica el centro de costos (CECO, siempre manual) y confirma/corrige la planta de consumo si M2 no la dedujo; **Gerencia** ve la factura ya revisada por Compras y la aprueba o rechaza. | 🔧 Backend construido, falta frontend |
| **M4 — Pago** | Marcar la factura como pagada una vez SAP procese el pago. | ⏸️ Aparcado — no existe hoy una fuente de datos fiable del estatus de pago por proveedor |
| **Dashboard** | Resúmenes ejecutivos: total de facturas, gasto por CECO/planta, estatus de aprobación. | 📋 Sin diseñar todavía |

### Lo que un usuario ve y puede hacer

- **Portal de facturas (M1+M2):** una tabla con todas las facturas de gas
  detectadas, filtrable por proveedor, fecha, planta y si SAP la validó o no.
  Al abrir una factura se ve su desglose (importe de gas, si es mixta, estado
  de registro en SAP, planta si se conoce).
- **Cola de Compras (M3, en construcción):** facturas pendientes de revisar.
  Compras captura el CECO (siempre a mano — no hay forma de derivarlo
  automáticamente de los datos de SAP disponibles) y confirma la planta si M2
  no la dedujo, con sugerencias desde catálogos conocidos pero sin bloquear si
  el dato correcto no aparece en la lista.
- **Cola de Gerencia (M3, en construcción):** facturas ya revisadas por
  Compras, con un botón de aprobar/rechazar tipo "one-tap".

### Limitaciones conocidas (no son bugs, son la realidad de los datos)

- El **CECO siempre se captura a mano** — no existe en ninguna tabla de SAP
  disponible la imputación de centro de costos por factura de gas.
- La **planta de consumo** solo se deduce automáticamente para ~54-58% de las
  facturas (el resto no tiene rastro de pedido con recepción en SAP) — el
  resto se captura a mano en M3.
- **No hay dirección postal/geográfica** de las plantas, solo el nombre de la
  sede.
- El **estatus de pago (M4) no es recuperable** de los datos actuales — se
  necesitaría una fuente de SAP que hoy no está disponible en el almacén.
- El **estatus de cancelación ante el SAT** se comprueba contra el webservice
  público del SAT (no viene en los datos de CFDI) — pendiente de construir.

Diseño completo, decisiones y SQL de origen en
[`Datos/PHASE1/`](./Datos/PHASE1/) (investigación de datos) y
[`Datos/PHASE2/`](./Datos/PHASE2/) (arquitectura) — **no se distribuyen por
git** (`Datos/` está en `.gitignore`), solo viven en el entorno de trabajo
local. El SQL de producto que construye las tablas `HCARB_*` sí está en git,
en [`ConsultasBigQuery/`](./ConsultasBigQuery/).

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

3. Abre **http://localhost:8080** e inicia sesión:

   | usuario | contraseña     |
   |---------|----------------|
   | `admin` | `carburos2026` |

Se levantan **3 contenedores**: `carb-nginx-dev`, `carb-frontend-dev`,
`carb-financialbi-dev`. Sin volúmenes con nombre (solo bind-mounts).

## Usuarios (.htpasswd)

Viven en `deploy/nginx/.htpasswd` (`usuario:hash-bcrypt`). Para añadir/cambiar:

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
# uv no hace falta instalarlo en el host; se usa vía contenedor:
docker run --rm -v "${PWD}:/w" -w /w ghcr.io/astral-sh/uv:latest uv lock
```

## Producción / despliegue

- **VM clásica**: `docker compose -f deploy/docker-compose.prod.yml up --build -d`
  (nginx con TLS — ajusta `deploy/nginx/nginx.prod.conf` y pon los certs en
  `deploy/nginx/ssl/`).
- **Cloud Run**: el `Dockerfile` del backend y el `Dockerfile.prod` del frontend
  respetan `$PORT`; se despliegan como dos servicios. Las tablas `HCARB_*`
  que lee el backend se construyen con `ConsultasBigQuery/` (hoy a mano, más
  adelante orquestado con Airflow — ver `Datos/PHASE2/resumen.md`), no con un
  Cloud Run Job propio del backend.
