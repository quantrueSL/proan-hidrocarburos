# Despliegue de facturas-api en Cloud Run

Servicio independiente, `plataforma-hidrocarburos-api` (código/imagen:
`facturas-api`), un solo contenedor — no es sidecar de
`plataforma-hidrocarburos` (ver [`../cloudrun/README.md`](../cloudrun/README.md)).
Expone XML y PDF de las facturas de gas que la herramienta ya clasifica
(`HCARB_GOLD_CLASIFICACION_FOLIO`), reconstruidos on-demand desde
`D00_SANDBOX.cfdi_raw` en cada petición — sin bucket, sin job de sincronización.

Mismo proyecto (`proan-quantrue`) y región (`us-west4`) que el resto de
Hidrocarburos, por lo mismo que allí: sin latencia extra entre regiones para
llegar a BigQuery.

## Estado de este despliegue

**Desplegado y en producción (2026-09-03)**, con acceso protegido de punta a
punta:

```
Cliente (con x-api-key)
      │
      ▼
API Gateway  https://plataforma-hidrocarburos-facturas-gw-3h14pa0v.wn.gateway.dev
  API:      plataforma-hidrocarburos-facturas
  Config:   facturas-config-20260903-155207  (openapi.yaml de este directorio)
      │  llama a Cloud Run con la identidad de:
      │  facturas-api-gateway@proan-quantrue.iam.gserviceaccount.com
      ▼
Cloud Run  plataforma-hidrocarburos-api  (us-west4)
  https://plataforma-hidrocarburos-api-272166156031.us-west4.run.app
  NO invocable directamente -- solo la cuenta de servicio de arriba tiene
  roles/run.invoker (verificado: ni siquiera el dueño del proyecto puede
  invocarlo sin ese rol).
```

Recursos creados, en orden:

1. `bash deploy/cloudrun-facturas-api/deploy.sh` — Cloud Run, sin invocación
   pública.
2. Cuenta de servicio dedicada `facturas-api-gateway` (permiso mínimo: solo
   `roles/run.invoker` sobre este Cloud Run -- no reutiliza la cuenta genérica
   `272166156031-compute@` que usa el resto del proyecto).
3. APIs habilitadas: `apigateway.googleapis.com`, `servicecontrol.googleapis.com`
   (`servicemanagement.googleapis.com` ya lo estaba).
4. `gcloud api-gateway apis create plataforma-hidrocarburos-facturas`
5. `gcloud api-gateway api-configs create facturas-config-20260903-155207`
   desde [`openapi.yaml`](./openapi.yaml), con
   `--backend-auth-service-account=facturas-api-gateway@...`
6. `gcloud api-gateway gateways create plataforma-hidrocarburos-facturas-gw`
7. Habilitado el "managed service" que crea el paso 4
   (`plataforma-hidrocarburos-facturas-2ll03uwymv3yn.apigateway.proan-quantrue.cloud.goog`)
   -- paso fácil de olvidar: sin esto, todas las peticiones dan 403 aunque la
   key sea válida.
8. Primera API key creada, restringida a este `managedService` únicamente
   (no una key genérica de Google Cloud) -- guardada fuera del repo, no vive
   en ningún archivo versionado.

**Para actualizar la API cuando cambien las rutas**: editar `openapi.yaml`,
crear un **Config nuevo** (los Configs son inmutables, nunca se edita uno
existente -- mismo principio que las etiquetas únicas de imagen en
`deploy.sh`), y actualizar el Gateway para que apunte a ese Config nuevo:
```bash
gcloud api-gateway api-configs create facturas-config-$(date +%Y%m%d-%H%M%S) \
  --api=plataforma-hidrocarburos-facturas \
  --openapi-spec=deploy/cloudrun-facturas-api/openapi.yaml \
  --backend-auth-service-account=facturas-api-gateway@proan-quantrue.iam.gserviceaccount.com \
  --project=proan-quantrue

gcloud api-gateway gateways update plataforma-hidrocarburos-facturas-gw \
  --api=plataforma-hidrocarburos-facturas \
  --api-config=<config-nuevo> \
  --location=us-west4 --project=proan-quantrue
```

**Dar de alta una key nueva para otro consumidor** (sigue siendo manual, solo
quien administre esto -- no hay autoservicio todavía, ni falta mientras sea
una sola persona):
```bash
gcloud services api-keys create \
  --display-name='facturas-api - <para quién>' \
  --api-target=service=plataforma-hidrocarburos-facturas-2ll03uwymv3yn.apigateway.proan-quantrue.cloud.goog \
  --project=proan-quantrue
```

## Variables de entorno

Igual que `financialbi` (ver [`../cloudrun/README.md`](../cloudrun/README.md)):
`BQ_PROJECT_ID`/`BQ_LOCATION` fijos en `service.yaml`, sin
`BQ_CREDENTIALS_PATH` — `facturas_api/db.py` cae a las credenciales de
aplicación (la identidad del servicio).

## Decisiones y detalles

- **Sin bucket, sin tarea de Airflow**: se decidió generar todo on-demand
  porque el volumen esperado de peticiones es bajo — evita staleness (un PDF
  cacheado que no refleje una cancelación SAT posterior) y piezas que puedan
  desincronizarse. Si el tráfico real lo justifica más adelante, se revisita
  con una capa de caché (Cloud CDN delante de un bucket, por ejemplo) — no se
  construye por adelantado.
- **`min-instances: 0`**: arranque en frío en la primera petición tras un rato
  sin tráfico. Con el volumen esperado, no se paga la instancia 24×7 solo para
  evitarlo.
- **`memory: 1Gi`**: WeasyPrint (renderizado de PDF) más la reconstrucción de
  facturas con muchas líneas de concepto (se probó una real con 131) piden más
  que el mínimo.
- **Identidad de servicio**: `272166156031-compute@`, la misma que el resto
  del proyecto — igual que en `plataforma-hidrocarburos`, tiene más permiso
  del necesario (rol *Editor*); una cuenta de servicio dedicada con permisos
  mínimos queda pendiente, igual que allí.
