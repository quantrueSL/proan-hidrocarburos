# Despliegue en Cloud Run

Un servicio, `hidrocarburos`, con dos contenedores: el frontend Next.js como
entrada y `financialbi` como sidecar en `localhost:8091`. El backend no tiene URL
pública, así que no hay autenticación entre servicios que mantener.

Proyecto `proan-quantrue`, región `us-west4` — la misma que BigQuery
(`BQ_LOCATION`), para no pagar latencia entre regiones.

## Preparación (solo la primera vez)

**1. Secreto de firma de sesión.** Sin él el frontend no arranca, a propósito:
una sesión sin firmar sería falsificable.

```bash
openssl rand -base64 48 | tr -d '\n' | \
  gcloud secrets create carb-session-secret --data-file=- \
    --project=proan-quantrue --replication-policy=automatic
```

**2. Usuarios técnicos (`.htpasswd`).** Se sube como secreto y se monta como
fichero en `/etc/carb/.htpasswd`; así los hashes no viven en el repositorio ni se
hornean en la imagen.

```bash
gcloud secrets create carb-htpasswd --data-file=deploy/nginx/.htpasswd \
  --project=proan-quantrue --replication-policy=automatic
```

**3. Permiso de lectura de secretos** para la identidad del servicio:

```bash
for s in carb-session-secret carb-htpasswd; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member=serviceAccount:272166156031-compute@developer.gserviceaccount.com \
    --role=roles/secretmanager.secretAccessor --project=proan-quantrue
done
```

## Desplegar

```bash
bash deploy/cloudrun/deploy.sh
```

Construye las dos imágenes con una etiqueta única, renderiza `service.yaml` y
reemplaza el servicio. Al terminar imprime la URL.

**La primera vez**, añade esa URL en Firebase Console → *Authentication* →
*Settings* → *Authorized domains*, o el botón de Google fallará con
`auth/unauthorized-domain`.

## Añadir un usuario técnico

No hace falta reconstruir imágenes, pero sí una revisión nueva: los secretos
montados como fichero se resuelven al arrancar la instancia.

```bash
htpasswd -B deploy/nginx/.htpasswd nuevousuario
gcloud secrets versions add carb-htpasswd --data-file=deploy/nginx/.htpasswd \
  --project=proan-quantrue
bash deploy/cloudrun/deploy.sh
```

Para los usuarios normales de la herramienta no hay que desplegar nada: se
gestionan en la lista de Firestore desde el portal de listas (ver `LOGIN.md`).

## Decisiones y detalles

- **Etiqueta única por despliegue** (`sha-fecha`). Con `:latest`, el spec del
  servicio no cambiaría, `gcloud run services replace` no crearía revisión y
  seguiría sirviendo la imagen anterior sin avisar.
- **`--allow-unauthenticated`** (vía `add-iam-policy-binding`): un navegador no
  envía tokens de IAM, así que cerrarlo dejaría fuera a todo el mundo. El login lo
  gestiona la aplicación. Cerrarlo de verdad sería poner IAP delante.
- **`min-instances: 0`.** Habrá arranque en frío en la primera petición, y el
  sidecar carga pandas y pyarrow, así que no es instantáneo. Subirlo a 1 lo evita
  a cambio de pagar la instancia 24×7.
- **`DOCKER_BUILDKIT=1`** en `cloudbuild.yaml`: el Dockerfile de `financialbi` usa
  `RUN --mount=type=cache`, que el constructor clásico no entiende.
- **Sin `BQ_CREDENTIALS_PATH`**: `db.py` cae a credenciales de aplicación, que en
  Cloud Run son la identidad del servicio. El JSON no entra en la imagen.
- **`FINANCIALBI_DB_BACKEND=bigquery`** es obligatorio: el valor por defecto en
  el código es `azure`.
- La identidad del servicio es `272166156031-compute@`, la misma que el resto del
  proyecto. Tiene rol *Editor*, mucho más de lo necesario; queda pendiente crear
  una service account dedicada con permisos mínimos.

## Lo que ya no se usa

`deploy/docker-compose.prod.yml` y `deploy/nginx/nginx.prod.conf` son herencia del
repositorio del que se recicló este proyecto y describen una VM que no existe. No
tomarlos como referencia.
