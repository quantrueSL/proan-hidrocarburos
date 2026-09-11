# Alertas de Hidrocarburos

Los JSON de esta carpeta describen las alertas activas de producción para
`plataforma-hidrocarburos` y el DAG `proan_produccion`.

- El canal `Pablo Coma Hidrocarburos` apunta a `pcoma@quantrue.com`. Los canales
  de correo no envían un mensaje de confirmación al crearse.
- La métrica de Composer solo cuenta un `DagRun` programado que termina en
  `failed`; no cuenta tareas fallidas de pruebas temporales.
- Las políticas de Cloud Run avisan con un 5xx en cinco minutos o p95 superior
  a 15 segundos durante diez minutos.

Para recrearlas con una cuenta autorizada:

```bash
gcloud logging metrics create hcarb_proan_produccion_scheduled_failures \
  --project=proan-quantrue \
  --config-from-file=deploy/monitoring/composer-scheduled-failure-metric.json

for policy in deploy/monitoring/*-policy.json; do
  gcloud monitoring policies create --project=proan-quantrue --policy-from-file="$policy"
done
```
