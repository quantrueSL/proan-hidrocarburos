# Producción

## Arquitectura actual

El servicio Cloud Run `plataforma-hidrocarburos`, en `proan-quantrue` y región
`us-west4`, ejecuta dos contenedores en la misma revisión:

- frontend Next.js, expuesto al navegador;
- FinancialBI, sidecar privado en `localhost:8091`.

FinancialBI consulta BigQuery mediante la identidad del servicio. Facturas API
se despliega y valida como servicio independiente. Los secretos de sesión,
usuarios técnicos y API key se leen desde Secret Manager; no se incluyen en el
repositorio.

El despliegue es deliberadamente manual. Ejecutar
`bash deploy/cloudrun/deploy.sh` desde una sesión `gcloud` autorizada construye
las imágenes con una etiqueta única y sustituye la revisión de Cloud Run. No
hay CD desde GitHub Actions.

La guía de preparación y despliegue está en
[`deploy/cloudrun/README.md`](../../deploy/cloudrun/README.md).

## Integración continua

Cada push a `main` ejecuta [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml):

- frontend: Node 20, pnpm, tests, lint, tipos y build de Next.js;
- Python: Python 3.11, `uv`, tests de FinancialBI y Facturas API;
- contenedores: builds locales de frontend, FinancialBI y Facturas API.

El CI no accede a GCP, no publica imágenes y no despliega. Una ejecución verde
confirma la integridad del cambio, pero el despliegue posterior sigue siendo una
decisión manual.

## Caché privada de FinancialBI

La caché vive dentro de cada instancia de Cloud Run; no usa Redis, Memorystore
ni caché HTTP pública. Se pierde al reiniciar una instancia y no se comparte
entre instancias.

| Datos | TTL | Capacidad |
| --- | ---: | ---: |
| Catálogos de proveedores, CECO, sitios y núcleo | 1 hora | 16 entradas |
| Resumen normal del dashboard | 5 minutos | 128 entradas |

Las colas de Compras y Gerencia, búsquedas, facturas, historial, rutas de
aprobación y las variantes `detalle=true` o `detalle_sat=true` nunca se
cachean. Una mutación correcta de Compras o Gerencia invalida el dashboard y
los catálogos de CECO y sitios en la instancia que la procesa.

Con dos instancias puede subsistir hasta cinco minutos un resumen previo en la
otra instancia. Las colas de aprobación siempre se consultan en origen.
