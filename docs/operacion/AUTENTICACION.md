# Autenticación y protección del login

## Acceso de usuarios

El acceso normal sigue usando Google/Firebase y los roles vigentes de la
aplicación. Este flujo no ha cambiado.

El endpoint técnico `POST /api/auth/login` valida los usuarios guardados en
`.htpasswd`. Su uso está pensado para los casos que no pueden entrar con
Google.

## Limitación de intentos del login técnico

El login técnico admite como máximo cinco intentos por IP en una ventana móvil
de quince minutos. El sexto responde `429` e incluye `Retry-After`.

El contador se coordina entre instancias mediante Firestore:

- base: `proan-lista-mails`;
- colección: `hcarb_login_rate_limits`;
- clave: HMAC-SHA256 de la IP con `SESSION_SECRET`.

No se guarda ni registra la IP, el usuario o la contraseña. Un login correcto
elimina su contador. Si Firestore no está disponible, se usa un contador local
acotado y se registra únicamente el evento técnico `rate_limit_store_error`.

Cada documento incluye `expires_at`; la política TTL de Firestore para esta
colección está activa desde el 12-sep-2026 y elimina automáticamente los
contadores caducados. La activación se documenta también en
[`deploy/cloudrun/README.md`](../../deploy/cloudrun/README.md).

Los eventos seguros asociados son `login_failed`, `login_blocked` y
`rate_limit_store_error`.
