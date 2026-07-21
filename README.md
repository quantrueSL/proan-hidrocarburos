# proan-Hidrocarburos

Herramienta de **reportes + alertas** financieras (sin agentes ni chat), derivada
de `proan-maka-rentabilidad`. Estructura tipo monorepo (como Maka, pero recortado):

```
apps/financialbi   backend FastAPI (BigQuery + Gemini para las "historias")
apps/frontend      frontend Next.js 14 (report + alertas, estética Proan)
deploy/            docker-compose (dev/prod) + nginx
config/            financialbi.env + bq_credentials.json (BigQuery)
pyproject.toml     workspace uv (miembro: apps/financialbi) + uv.lock
```

- **Backend**: endpoints `/v1/financialbi/{catalog,report,alerts,alerts_mtd,historias,historias_mtd}`.
- **Frontend**: autenticación por **`.htpasswd`** (bcrypt), verificada dentro del
  propio Next (sin auth-service ni gateway). **nginx** delante hace solo de
  reverse-proxy (igual que con el frontend-react de Maka).

> Estado: los datos son los de **Maka** (proyecto BigQuery `proan-quantrue`) para
> ver la herramienta funcionando. Las tablas propias de hidrocarburos están
> pendientes; al crearlas se cambian en `config/financialbi.env` y en los motores
> (`report_engine.py`, `alertas_engine.py`, `materialize_alerts.py`, donde los
> nombres de tabla siguen hardcodeados a `MAKA_*`).

## Levantar en local (desarrollo)

Requisitos: Docker Desktop. Desde la **raíz del repo**:

1. **Secretos LLM**

   ```bash
   cp .env.example .env
   # edita .env y pon tu LLM_API_KEY de Gemini
   ```

2. **Credenciales BigQuery** — service-account (lectura sobre `proan-quantrue`) en:

   ```
   config/bq_credentials.json
   ```

3. **Arrancar**

   ```bash
   docker compose -f deploy/docker-compose.dev.yml up --build
   ```

4. Abre **http://localhost:8080** e inicia sesión:

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
  respetan `$PORT`; se despliegan como dos servicios. La **materialización de
  alertas** (`python -m financialbi.materialize_alerts …`) va como **Cloud Run
  Job** + scheduler (escribe las tablas GOLD que el web solo lee). No hace falta
  para *ver* datos en local (las GOLD de Maka ya están pobladas).
