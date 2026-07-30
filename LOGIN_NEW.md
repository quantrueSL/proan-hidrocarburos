# Cómo montar login con Google y lista de acceso en Firestore

Guía para llevar este patrón a otra herramienta. No asume framework: sirve para
Next.js, Flask, Django, Express, FastAPI o una página HTML con un backend
cualquiera. Tampoco asume cómo es tu login actual — puede ser LDAP, contraseñas en
base de datos, `.htpasswd` o nada.

Lo específico de Hidrocarburos (rutas, roles concretos, decisiones tomadas) está
en `LOGIN.md`. Aquí va el patrón y, sobre todo, **las trampas**, que es lo que
cuesta descubrir.

---

## La idea

Dos preguntas distintas, resueltas por dos sistemas distintos:

```
¿Quién eres?          → Google / Firebase Authentication
¿Qué puedes hacer      → una lista que tú controlas
 en ESTA herramienta?     (correo → rol)
```

Separarlas es lo que hace que el patrón escale. Un mismo directorio de identidad
puede servir a varias herramientas, y cada una decide por su cuenta quién entra y
con qué permisos. Que alguien exista en el directorio no le da acceso a nada.

El resultado del login **no es la sesión de Google**: es **tu propia sesión**.
Google solo interviene un instante, para acreditar el correo.

```
navegador                        tu servidor
   │  (1) SDK de Google → ID token
   │───────── POST /auth/google {idToken} ──────────►
   │                                 (2) verifica la firma del token
   │                                 (3) exige que venga de Google
   │                                 (4) busca el correo en la lista
   │◄──────── cookie de sesión propia (con el rol) ──
```

---

## Pasos

### 1. Proyecto de Firebase y proveedor de Google

En `console.firebase.google.com`, sobre un proyecto de Google Cloud (puede ser uno
existente; añadir Firebase no toca lo que ya hay dentro):

- *Authentication* → habilitar.
- *Método de acceso* → activar **Google**. Te pedirá un nombre público y un correo
  de asistencia: son del **proyecto entero**, no de tu app. Si vas a compartir el
  proyecto entre herramientas, pon un nombre genérico de la empresa, no el de una.
- No habilites más proveedores de los que vayas a usar (ver trampa 1).

Firebase crea por detrás el cliente OAuth. No hace falta tocar la consola de
Google Cloud para eso.

**¿Firebase o OAuth de Google a pelo?** Firebase si prevés varias herramientas o
añadir más proveedores después (Microsoft, enlace por correo: son interruptores).
OAuth directo si es una sola app y no quieres el SDK; a cambio gestionas tú el
*client secret*. Con Firebase tu aplicación no custodia ningún secreto de OAuth.

### 2. Registrar la aplicación y obtener la configuración

*Configuración del proyecto* → *Tus apps* → icono web. Te da:

```
apiKey, authDomain, projectId, appId
```

Son **públicos por diseño**: viajan en el JavaScript del navegador de cualquier web
que use Firebase. Lo que nunca sale del servidor son las claves de service account.

### 3. Decidir el alcance: Internal o External

La pantalla de consentimiento OAuth del proyecto puede ser:

- **Internal** — solo cuentas de la organización de Google Workspace dueña del
  proyecto. Cualquier otra recibe `Error 403: org_internal`.
- **External** — cualquier cuenta de Google, pero hay que **publicarla**: en modo
  *Testing* solo entran hasta 100 correos dados de alta a mano. Publicar no
  requiere revisión si solo pides `openid`, `email` y `profile`.

Si todos tus usuarios son del dominio corporativo, **Internal es mejor**: te deja
dos puertas en serie, la organización y tu lista. Si necesitas gente de fuera
(clientes, proveedores, cuentas personales), tiene que ser External, y entonces tu
lista es la **única** puerta.

Está en la consola de Google Cloud, *APIs y servicios* → *Pantalla de
consentimiento de OAuth* (o *Google Auth Platform* → *Audiencia*).

### 4. La lista de acceso

Necesitas un sitio donde apuntar **quién entra y con qué rol**, que sea barato de
leer y editable por alguien que no programa. Firestore va bien; una tabla SQL o un
fichero en un bucket también. Forma mínima:

```
emails:  ["ana@empresa.com", "luis@empresa.com"]   ← quién entra
roles:   { "ana@empresa.com": "admin" }            ← qué puede hacer
enabled: true
```

Tres reglas que conviene fijar desde el principio:

- **La lista de correos es la puerta; los roles solo reparten.** Un correo con rol
  asignado que no esté en la lista **no entra**. Así dar de baja a alguien es
  borrarlo de un sitio, no de dos.
- **Sin rol asignado → el rol menos privilegiado.** El permiso se concede, nunca
  se hereda.
- **Rol irreconocible → el menos privilegiado.** Una errata al teclear quita
  permisos, nunca los concede.

Si la lista la edita una interfaz que guarda el documento entero (un `set` sin
merge), cuidado: cualquier campo que esa interfaz no conozca se borra en cada
guardado. Distingue "no me lo has mandado" (conservar) de "mándamelo vacío"
(borrar).

### 5. El cliente obtiene el token

Con el SDK web de Firebase, en cualquier framework o en HTML plano:

```js
// pseudocódigo
const auth = getAuth(initializeApp(config));
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });   // ver trampa 3

const credential = await signInWithPopup(auth, provider);
const idToken = await credential.user.getIdToken();
await signOut(auth);                                          // ver trampa 2

await fetch("/auth/google", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ idToken })
});
```

Carga el SDK **solo cuando el usuario pulsa el botón** (import dinámico o script
diferido): así no pesa en la carga de la pantalla de login, y quien entre por tu
otro método no lo descarga nunca.

### 6. El servidor verifica y decide

Aquí está el núcleo. Cuatro comprobaciones, en este orden:

```python
# pseudocódigo (Python con firebase_admin; en Node es firebase-admin,
# y existe equivalente en Go, Java y PHP)

claims = firebase_auth.verify_id_token(id_token)      # 1. firma válida

if claims["firebase"]["sign_in_provider"] != "google.com":
    return 403                                        # 2. viene de Google
if not claims.get("email_verified"):
    return 403                                        # 3. correo verificado

email = claims["email"].strip().lower()
decision = buscar_en_lista(email)                     # 4. autorizado
if decision.status == "no_autorizado":
    return 403, "Tu cuenta no tiene acceso"
if decision.status == "no_disponible":
    return 503, "Vuelve a intentarlo"                 # ver trampa 5

emitir_sesion(email=email, rol=decision.rol)
```

Sin el SDK de administración también se puede: el ID token es un JWT firmado por
Google y se valida contra sus claves públicas (JWKS), comprobando emisor y
audiencia. El SDK te ahorra la rotación de claves; si tu lenguaje no lo tiene, usa
una librería de JWT con JWKS remoto.

Devuelve **tres respuestas distintas para tres situaciones distintas**: 401 si el
token no se verifica, 403 si la cuenta no tiene acceso, 503 si tu almacén de la
lista no responde. Es la diferencia entre "no tienes acceso" y "vuelve a
intentarlo", y entre un log útil y uno que miente.

### 7. Tu propia sesión

Emite una cookie **firmada** (HMAC con un secreto del servidor, o cualquier
mecanismo de sesión de tu framework) que contenga al menos correo y rol:

- **Firma obligatoria.** Si el contenido no va firmado, cualquiera se pone el rol
  que quiera editando la cookie. Que el payload sea legible no importa: correo,
  rol y caducidad no son secretos. Lo que no debe poderse es *escribirlo*.
- **Comprueba la caducidad en el servidor**, no solo con el atributo de la cookie:
  una cookie copiada no expira por su cuenta.
- `HttpOnly`, `Secure` en producción, `SameSite` según tu dominio.
- El secreto de firma, en un gestor de secretos, y **falla al arrancar si falta**.
  Es mejor no arrancar que servir sesiones sin firma real.

### 8. Autorizar en el servidor

Ocultar un botón es cosmética, no seguridad. Cada operación se comprueba en el
servidor con el rol **de la sesión**, nunca con algo que venga en la petición.

Dos cosas que suelen olvidarse:

- **La identidad que guardas en tus datos** (quién aprobó, quién editó) tiene que
  salir de la sesión. Si la envía el cliente, tu auditoría es decorativa. Lo más
  limpio es que el cliente ni la reciba, así no puede expresarla.
- **Declara qué rol necesita cada ruta como lista blanca.** Lo que no esté
  declarado, se deniega. Enumerar prohibiciones deja fuera lo que añadas mañana.

### 9. Convivir con tu login actual

Las dos vías deben acabar **en la misma sesión**, para que el resto de la
aplicación no sepa por dónde entró nadie. Solo cambia de dónde sale el rol:

| Vía | Rol |
|---|---|
| Google | de la lista |
| Tu método actual | el que decidas por defecto para esa vía |

Y en la pantalla de login, jerarquía: la vía de la mayoría destacada y la técnica
o de emergencia replegada tras un desplegable. Dos botones al mismo nivel hacen
que el usuario tenga que elegir entre dos cosas que no entiende.

### 10. Despliegue

- El dominio desde el que sirves **tiene que estar** en Firebase → *Authentication*
  → *Settings* → *Authorized domains*. `localhost` viene de fábrica. Si falta:
  `auth/unauthorized-domain`.
- La configuración del SDK, mejor leída en el servidor y pasada al cliente que
  incrustada al compilar: si la metes en el bundle, la misma imagen no sirve para
  dos entornos.
- El secreto de sesión, en el gestor de secretos de tu plataforma.
- Si tu otro método usa un fichero (usuarios, hashes), en un contenedor no hay
  disco persistente: móntalo como secreto-fichero, no lo hornees en la imagen.

---

## Trampas

Por orden de "cuánto duele descubrirlo tarde".

**1. Un token obtenido con contraseña es igual de válido que uno de Google.**
Verificar la firma solo prueba que el token lo emitió *tu proyecto de Firebase*. Si
el proyecto tiene habilitado el proveedor de correo y contraseña —porque otra
herramienta lo usa—, alguien con una cuenta de esas presenta su token y **pasa la
verificación**. Por eso hay que exigir `firebase.sign_in_provider == "google.com"`
y rechazar el resto. Sin eso, un correo que entre algún día en tu lista tendría dos
puertas sin que nadie lo haya decidido.

**2. Dos sesiones vivas a la vez.** El SDK deja al usuario con sesión de Firebase
abierta en el navegador, además de la tuya. Son independientes y se desincronizan:
cierras la tuya y Firebase sigue dentro, o al revés. Cierra la de Firebase justo
después de canjear el token; tu sesión es la cookie.

**3. Google reutiliza la última cuenta.** Sin `prompt: "select_account"`, quien
tenga varias cuentas no puede cambiar, y tú no puedes probar dos roles con dos
cuentas distintas.

**4. El rol se congela al iniciar sesión.** Si consultas la lista solo en el login
y guardas el rol en la sesión, cambiar la lista **no afecta a las sesiones
abiertas**: quitar a alguien le impide el *siguiente* login, pero su sesión vale
hasta que caduque. Decide si te vale, y si necesitas revocación inmediata,
revalida en cada petición (con caché sale casi gratis, pero exige que leer la
sesión pueda ser asíncrono).

**5. Si el almacén de la lista no responde, deniega.** Nunca concedas por defecto.
Y no sirvas una copia caducada de la caché "para no dejar a nadie fuera": alargas
sin límite la ventana en la que alguien dado de baja sigue entrando. Deja tu otro
método de login como vía de emergencia.

**6. Cachea la lista, con la ventana en mente.** Sin caché pagas una lectura por
petición; con caché, un alta o una baja tarda en surtir efecto lo que dure el TTL.
30–60 segundos es un buen punto. No caches los fallos, y comparte la lectura en
vuelo para que N peticiones simultáneas no lancen N consultas.

**7. Los alias de correo devuelven el principal.** Si `facturacion@empresa.com` es
un alias de otra cuenta, el token trae el correo **principal**: pon ese en la
lista. Y un **grupo o lista de distribución no puede iniciar sesión nunca**: recibe
correo, no autentica. Los alias con `+` tampoco sirven: Google resuelve a la cuenta
principal.

**8. Normaliza los correos en los dos lados** (minúsculas, sin espacios). Es la
causa más tonta de "está en la lista y no entra".

**9. Buzones compartidos rompen la auditoría.** Una cuenta que usan cinco personas
hace que tus registros digan quién no fue. Si va a tomar decisiones, cuentas
nominales.

**10. `Internal` bloquea a los de fuera antes de llegar a tu código.** El error es
`org_internal` y no lo verás en tus logs, porque la petición nunca llega. Si tus
cuentas de prueba son personales y tu proyecto es Internal, no podrás probar nada.

---

## Lo que este patrón no resuelve

- **Límite de intentos** en tu login de contraseña. Aparte.
- **Cerrar el servicio a nivel de red.** Si el navegador tiene que llegar, el
  servicio es público y tu login es la única barrera. Para cerrarlo de verdad hace
  falta un proxy de identidad (IAP o equivalente) delante.
- **MFA, expiración de contraseñas, políticas corporativas.** Eso lo hereda del
  proveedor de identidad, no lo pones tú.
- **Auditoría inmutable.** Guardar el último estado no es un historial.
- **Quién puede editar la lista.** Es tan crítico como el propio login: quien pueda
  añadirse con rol de administrador tiene acceso total. Protege esa herramienta al
  menos igual que la que estás protegiendo.
