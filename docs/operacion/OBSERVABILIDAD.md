# Observabilidad y alertas

## Logs estructurados

FinancialBI emite JSON a Cloud Logging para:

- cada petición, con ruta, método, estado y duración;
- cada consulta BigQuery, con resultado y duración;
- cada acceso a caché, con `namespace`, `hit` o `miss` y `age_seconds`;
- arranque de una instancia.

No se registran UUID, filtros, datos de factura, credenciales ni direcciones
IP en esos eventos.

## Verificar la caché desplegada

1. Acceder al portal y abrir dos veces seguidas el mismo dashboard normal o
   catálogo, con los mismos filtros.
2. En Cloud Logging, filtrar los eventos JSON de FinancialBI con `event=cache`.
3. Debe aparecer primero `miss` y después `hit` para el mismo `namespace`.

No verificar el rate limit realizando intentos fallidos en producción: se
reservan intentos reales para esa IP.

## Alertas activas

Cloud Monitoring notifica a `pcoma@quantrue.com` cuando ocurre cualquiera de
estos casos:

- al menos un 5xx del portal en cinco minutos;
- latencia p95 de Cloud Run superior a 15 segundos durante diez minutos;
- un `DagRun` programado completo de `proan_produccion` termina en `failed`.

La alerta de Composer no notifica tareas aisladas ni ejecuciones manuales de
prueba. Los ficheros reproducibles de políticas y métrica están en
[`deploy/monitoring/`](../../deploy/monitoring/); la guía de recreación está
en su [README](../../deploy/monitoring/README.md).

El correo fue validado mediante una alerta de prueba y el canal está operativo.
