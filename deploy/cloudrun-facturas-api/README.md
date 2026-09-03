# Despliegue de facturas-api en Cloud Run

Servicio independiente, `facturas-api`, un solo contenedor — no es sidecar de
`plataforma-hidrocarburos` (ver [`../cloudrun/README.md`](../cloudrun/README.md)).
Expone XML y PDF de las facturas de gas que la herramienta ya clasifica
(`HCARB_GOLD_CLASIFICACION_FOLIO`), reconstruidos on-demand desde
`D00_SANDBOX.cfdi_raw` en cada petición — sin bucket, sin job de sincronización.

Mismo proyecto (`proan-quantrue`) y región (`us-west4`) que el resto de
Hidrocarburos, por lo mismo que allí: sin latencia extra entre regiones para
llegar a BigQuery.

## Estado de este despliegue

Este directorio deja **el servicio de Cloud Run listo para construirse**, pero
**deliberadamente no público**: `deploy.sh` no añade ningún
`add-iam-policy-binding` (a diferencia de `deploy/cloudrun/deploy.sh`, que sí
lo hace porque ahí el login lo gestiona la propia aplicación). Aquí el control
de acceso debe vivir en API Gateway, no en Cloud Run directamente.

**Pendiente, sin ejecutar todavía (acción deliberada, a decidir cuándo):**

1. `bash deploy/cloudrun-facturas-api/deploy.sh` — construye y despliega el
   Cloud Run (sin hacerlo invocable públicamente).
2. Configurar **API Gateway**: escribir el spec OpenAPI de las rutas de
   `facturas_api/app.py`, crear el Gateway apuntando a este Cloud Run como
   backend, y dar `roles/run.invoker` a la identidad de servicio de ese
   Gateway (no a `allUsers`) — es lo que hace que solo las peticiones que ya
   pasaron por la validación de API key de Gateway lleguen aquí.
3. Dar de alta la **primera API key** (manual, vía consola de GCP o `gcloud`,
   de momento solo para quien administre esto) — no hay interfaz de
   autoservicio para esto todavía, ni falta mientras solo la gestione una
   persona.

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
