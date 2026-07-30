# Pendientes para producción en Cloud Run

Este documento recoge decisiones que no deben resolverse con parches locales.
Se revisará antes del despliegue definitivo.

> **Estado a jul-2026.** Partes de este checklist ya están resueltas o se
> decidieron de otra forma. Donde haya discrepancia, manda lo que digan:
>
> - `LOGIN.md` (raíz) — autenticación, roles y autorización: el apartado 4 de
>   aquí está **hecho**, salvo el rate limiting.
> - `deploy/cloudrun/README.md` — despliegue real. En particular, el apartado 1
>   de aquí queda **superado**: no son dos servicios separados, es **un servicio
>   con dos contenedores** (el backend como sidecar en `localhost`, sin URL
>   pública), lo que elimina la necesidad de autenticación entre servicios.
>
> Sigue vigente y sin hacer: caché (apartado 2), pipeline y escrituras (3),
> auditoría (5) y observabilidad (6).

## 1. Arquitectura de despliegue

> Superado: ver el aviso de arriba. Se optó por un servicio con sidecar.

- ~~Desplegar frontend Next.js y FinancialBI como servicios privados separados.~~
- ~~Permitir que el frontend invoque FinancialBI mediante identidad de servicio,
  no mediante una URL pública sin autenticación.~~
- Guardar credenciales, claves y configuración sensible en Secret Manager.
- No incluir `bq_credentials.json` dentro de ninguna imagen.
- Usar una service account con permisos mínimos sobre las tablas necesarias.
- Confirmar región de Cloud Run y BigQuery para evitar latencia entre regiones.
- Configurar health checks, límites de memoria/CPU, concurrencia y timeout.
- Valorar `min-instances=1` si se prioriza evitar cold starts. Documentar su coste.

## 2. Estrategia de caché

No aplicar el mismo TTL a todos los endpoints.

| Datos | TTL inicial | Invalidación |
|---|---:|---|
| Catálogo de proveedores y claves SAT | 1 hora | Nueva carga del pipeline |
| Catálogos CECO y sitios | 1 hora | Nueva carga o captura manual relevante |
| Dashboard | 5–15 minutos | Aprobar, rechazar, reabrir o validar |
| Detalle de clasificación | 30 minutos | Nueva reconstrucción de tablas GOLD |
| Colas de Compras/Gerencia | Sin caché | Siempre operativas |
| Búsqueda paginada | Sin caché inicialmente | Evaluar con métricas reales |

La caché debe ser privada. No publicar respuestas autenticadas mediante CDN.

Para un único proceso estable puede utilizarse caché TTL en aplicación. Si el
servicio escala a varias instancias y se necesita coherencia estricta, valorar
Memorystore. No incorporarlo antes de que el tráfico lo justifique.

Después de implementar caché:

- exponer `Cache-Control` solo cuando sea seguro;
- registrar hit/miss y edad de la respuesta;
- verificar que una decisión operativa invalida dashboard y catálogos afectados;
- comprobar el comportamiento después de reinicios y escalado horizontal.

## 3. Pipeline y escrituras

- Mover `sync_pendientes()` al DAG de Airflow que reconstruye las tablas GOLD.
- No ejecutar sincronizaciones o DDL desde endpoints GET.
- Ejecutar creación/migración de esquemas como tarea de despliegue controlada,
  no durante el arranque de cada instancia.
- Orquestar clasificación, validación SAP, sincronización de pendientes y SAT
  con dependencias y reintentos explícitos.
- Registrar la fecha de actualización y el identificador de ejecución del DAG.

## 4. Autenticación y autorización

La autenticación actual por `.htpasswd` es provisional.

Antes de producción definitiva:

- decidir con el cliente el proveedor de identidad: Google Identity Platform,
  Microsoft Entra ID, Google Workspace u otro SSO corporativo;
- sustituir la sesión Base64 por una sesión firmada y cifrada o tokens validados;
- validar expiración, emisor, audiencia y rotación de claves;
- definir roles mínimos: `compras`, `gerencia`, `consulta` y `administrador`;
- autorizar cada endpoint en servidor; ocultar botones no sustituye autorización;
- obtener el usuario y sus roles de la sesión, nunca del body enviado por React;
- impedir que un usuario de Compras apruebe como Gerencia y viceversa;
- añadir protección CSRF a operaciones mutables si el mecanismo elegido la requiere;
- aplicar rate limiting al login y registrar intentos fallidos;
- decidir recuperación de acceso, alta/baja de usuarios y soporte;
- activar cookies `Secure`, `HttpOnly` y `SameSite` según el dominio definitivo.

## 5. Auditoría

- Crear un historial inmutable de decisiones, no solo el último estado.
- Guardar usuario autenticado, rol, instante, estado anterior/nuevo y motivo.
- No permitir modificar el usuario registrado desde el cliente.
- Definir retención y acceso a logs con el cliente.

## 6. Observabilidad

- Emitir logs estructurados con endpoint, duración total y duración BigQuery.
- Añadir métricas de latencia p50/p95/p99, errores, cold starts y caché.
- Configurar alertas para errores 5xx, latencia elevada y fallos del pipeline.
- Evitar devolver consultas, nombres de contenedores o errores internos al usuario.
- Añadir trazas entre frontend, FinancialBI y BigQuery si la latencia lo exige.

## 7. Validación previa a salida

- Generar la imagen final y el artefacto `standalone` en Linux/CI; Windows puede
  bloquear los enlaces simbólicos que crea Next.js.
- Añadir `sharp` a la imagen final y comprobar la optimización de imágenes.
- Usar la versión de pnpm declarada por el proyecto, sin regenerar el lockfile
  con una versión global diferente.
- Ejecutar build de producción y pruebas automáticas.
- Probar permisos con una cuenta por rol.
- Verificar navegación, filtros y decisiones sobre datos de prueba.
- Confirmar que no existen secretos en imágenes, variables públicas o logs.
- Medir tiempos con caché fría y caliente.
- Probar reinicio, nueva instancia y fallo temporal de BigQuery.
- Validar accesibilidad básica y resolución de escritorio acordada con el cliente.
