# Credenciales de la gestoría (ICOGAM)

Para operar en producción con el Colegio, la gestoría necesita sus propias
credenciales: el **certificado colegial**, su contraseña y la **clave API** o
el **token** que le haya otorgado ICOGAM.

Este módulo las guarda. No las usa todavía: la llamada real a ICOGAM llegará
cuando exista la homologación.

---

## La regla que manda aquí

**Un secreto guardado no se puede volver a leer.** Ni desde la pantalla, ni
desde la API, ni consultando la base de datos.

Se pueden **reemplazar** y **borrar**, no consultar. Si la gestoría pierde una
clave, sube otra. Esto no es una limitación de la interfaz que haya que
"arreglar" más adelante: es el punto entero del módulo. Una credencial que la
aplicación puede leer es una credencial que se puede sacar con una sesión
robada o un XSS.

---

## Cómo está montado

```
Navegador                Edge Function                    Postgres
─────────                ─────────────                    ────────
credenciales.js  ──POST──▶ gestotrafic-credenciales ──────▶ gestotrafic_credenciales
  (sin secretos)           · valida el JWT                   · RLS SIN políticas
                          · exige rol admin                  · revoke a anon/authenticated
                          · CIFRA (AES-256-GCM)              · solo service_role
                          · nunca devuelve un secreto
```

### 1 · La tabla es inalcanzable desde el navegador

`gestotrafic_credenciales` tiene RLS activado y **cero políticas**, más un
`revoke` explícito a `anon` y `authenticated`. Sin política no hay acceso: la
tabla no responde ni con una lista vacía, responde con un error de permisos.

Es la misma protección que ya tiene `gestotrafic_usuarios`, y es más dura que
la de `gestotrafic_expedientes`. Se puede comprobar con la clave anon, que es
pública por diseño:

| Tabla | Protección | Respuesta a `anon` |
|---|---|---|
| `gestotrafic_expedientes` | RLS con política | `200` y `[]` |
| `gestotrafic_usuarios` | revoke | `401` · `42501` |
| `gestotrafic_credenciales` | revoke + RLS sin políticas | `401` · `42501` |

> **No añadas una política de lectura "solo para el admin".** Convertiría los
> secretos en legibles desde el cliente y se acabó el write-only.

### 2 · Los secretos se cifran fuera de Postgres

El cifrado es **AES-256-GCM** y ocurre en la Edge Function, con IV aleatorio
por campo. La clave vive en la variable de entorno `GESTOTRAFIC_CRED_KEY` y
**nunca** en la base de datos ni en el repositorio.

Que la clave esté fuera de Postgres es lo que hace que **un volcado completo de
la base no baste** para descifrar nada.

```bash
openssl rand -base64 32
supabase secrets set GESTOTRAFIC_CRED_KEY='...' --project-ref <ref>
```

Si se pierde la clave, lo guardado es irrecuperable y hay que volver a subirlo.
Es el comportamiento correcto.

### 3 · Solo el administrador

El rol se comprueba **dos veces**: en la interfaz, para no ofrecer lo que se va
a negar, y en el servidor con `getUser()` + consulta del perfil, que es la que
corta de verdad. Un gestor que edite el JavaScript o llame a la función a mano
recibe un `403`.

La pestaña **Credenciales** solo aparece para el admin, igual que **Gestores**.

### 4 · Aislamiento entre gestorías

Cada gestoría tiene **su propio proyecto Supabase** (ver
[`deploy/provision.sh`](../deploy/provision.sh)), así que la separación entre
gestorías es **física**, no por fila: la gestoría A no tiene ninguna ruta hacia
la base de la gestoría B.

Dentro de una instalación, lo que separa es el rol. Si algún día varias
gestorías compartieran base, el sitio donde entraría una columna `gestoria_id`
y su política está señalado en la cabecera de
[`03_credenciales.sql`](../deploy/install/03_credenciales.sql); el resto del
diseño no cambia.

---

## Qué se ve y qué no

La pantalla nunca muestra un secreto. Solo:

- si cada pieza está configurada,
- el nombre y el tamaño del fichero del certificado,
- una **pista de 4 caracteres** de la clave API y del token, para distinguir
  una de otra sin poder reconstruirlas,
- quién la actualizó y cuándo.

Los campos del formulario van **siempre vacíos**, incluso con algo ya guardado.
Dejarlos vacíos significa "no lo cambies".

---

## Gating de la operación con el Colegio

Mientras la gestoría no tenga credenciales, la **exportación queda
deshabilitada** y aparece:

> **Exportación deshabilitada.** Configura tus credenciales de ICOGAM para
> operar con el Colegio.

Se considera configurada cuando hay **certificado + (clave API o token)**.

El gating **falla cerrado**: si no se puede consultar el estado —red caída,
función sin desplegar— se asume que NO hay credenciales. Habilitar la operación
porque no se pudo preguntar sería exactamente el fallo que este módulo existe
para evitar.

> El botón deshabilitado **no es la barrera de seguridad**. La barrera estará
> en el servidor, en la Edge Function que use las credenciales. Deshabilitar el
> botón sirve para que el gestor entienda por qué no puede exportar todavía.

---

## Instalar

1. Aplicar [`deploy/install/03_credenciales.sql`](../deploy/install/03_credenciales.sql).
2. Generar y guardar la clave de cifrado (arriba).
3. Desplegar la función **con `--no-verify-jwt`**: valida el JWT ella misma y
   necesita responder al preflight CORS.

```bash
supabase functions deploy gestotrafic-credenciales --no-verify-jwt --project-ref <ref>
```

---

## Comprobar que está bien

| Qué | Cómo | Esperado |
|---|---|---|
| Un admin guarda | Pestaña Credenciales → subir certificado y clave | Estado pasa a *Configurado*; los campos siguen vacíos |
| No se leen desde el cliente | `GET /rest/v1/gestotrafic_credenciales` con la clave anon | `401` · `42501` |
| Tampoco con sesión de gestor | Lo mismo con el JWT de un gestor | `401` · `42501` |
| Un gestor no puede guardar | `POST` a la función con su JWT | `403` |
| Sin credenciales no se exporta | Entrar en la pestaña de exportación | Botón deshabilitado + aviso |
| El secreto no vuelve | Cualquier acción de la función | Ninguna respuesta contiene el valor |
