# Próximos pasos de producción

Estado actualizado el 12-sep-2026. El detalle del estado implementado está en
[`docs/README.md`](docs/README.md).

## Verificación inmediata

- Autenticarse en el portal y consultar dos veces seguidas el mismo dashboard o
  catálogo. Confirmar en Cloud Logging un evento `cache` con `miss` y, después,
  otro con `hit` para el mismo `namespace`. No hace falta probar el bloqueo del
  login en producción, pues consumiría intentos reales.

## Para más adelante

### Historial de auditoría de aprobaciones

Mantener la tabla actual como estado presente y añadir una tabla append-only de
eventos. Cada transición debe conservar usuario, rol, instante, estado anterior,
estado nuevo y motivo.

### Service account dedicada

Sustituir la service account predeterminada de Compute Engine por una exclusiva
de Hidrocarburos con permisos mínimos de BigQuery, Firestore y los tres secretos
necesarios.

### DDL fuera del arranque

Mover la creación o migración de esquemas BigQuery a un paso de despliegue
controlado. No es urgente: las operaciones actuales son idempotentes y el
servicio funciona.

### Validación de imágenes

Comprobar en CI que la imagen final de Next.js funciona en Linux y decidir si
`sharp` es necesario según el uso real de optimización de imágenes.
