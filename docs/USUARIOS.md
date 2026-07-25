# Usuarios y aislamiento por gestor

GestoTrafic es multiusuario: el **administrador** da de alta gestores y cada
**gestor** ve y gestiona **solo sus expedientes**.

La separación **la impone el servidor**, no la interfaz. Ocultar botones es
cosmético; aquí lo que corta es el RLS de PostgreSQL. Un gestor que edite el
JavaScript, llame a la API a mano o pruebe URLs de expedientes ajenos sigue sin
poder leerlos.

---

## Credenciales de demostración

| Usuario | Contraseña | Rol |
|---|---|---|
| `admin` | `demo` | Administrador · ve todos los expedientes |
| `gestor` | `demo` | Gestor (Laura Ortega) |
| `marcos` | `demo` | Gestor (Marcos Delgado) |

Las contraseñas se guardan con **bcrypt** y nunca en claro.

---

## Cómo funciona el login

El login **ya no se resuelve en el navegador**:

1. `index.html` envía usuario y contraseña a la Edge Function
   **`gestotrafic-auth`**.
2. La función llama a `gestotrafic_verificar_credenciales(...)`, que compara la
   contraseña con el hash **bcrypt** guardado en `gestotrafic_usuarios`.
   Esa función es `SECURITY DEFINER` y **solo la puede ejecutar el
   `service_role`**: ni `anon` ni `authenticated` pueden invocarla, así que la
   comprobación nunca ocurre en el cliente.
3. Si las credenciales son válidas, la función emite una **sesión de Supabase
   firmada** y la devuelve.
4. `api.js` instala esa sesión en el cliente de Supabase. A partir de ahí cada
   consulta viaja con el JWT del usuario y el RLS decide qué filas devuelve.

### Por qué hay una sesión de Supabase detrás

El RLS necesita saber *quién* pregunta, y la forma estándar de saberlo en
Postgres es `auth.uid()`. Por eso cada usuario del CRM tiene una fila espejo en
`auth.users` cuyo único papel es **sostener el JWT de la sesión**: la
contraseña real vive en `gestotrafic_usuarios.password_hash` y la verificamos
nosotros. La contraseña interna de `auth.users` es un valor aleatorio que nadie
conoce ni usa.

Bcrypt se calcula con **pgcrypto** (`crypt` / `gen_salt('bf', 10)`) en lugar de
una implementación WASM en el runtime de Deno: es el mismo algoritmo y una
dependencia menos que pueda fallar en producción.

---

## Reglas de visibilidad

| | Gestor | Administrador |
|---|---|---|
| Expedientes | solo los suyos (`gestor_id = auth.uid()`) | todos |
| Dashboard y Kanban | filtrados por el RLS | completos |
| Documentos | solo los de sus expedientes | todos |
| Reasignar expediente | ✗ | ✓ |
| Panel de Gestores | ✗ | ✓ |
| Ver otros usuarios | solo su ficha | todas |
| Clientes | agenda **compartida** | agenda compartida |

Los clientes son deliberadamente comunes: en una gestoría la agenda es de la
casa, no de cada gestor.

### Dueño del expediente

`gestotrafic_expedientes.gestor_id` apunta al gestor que lo creó. Al dar de alta
un expediente se rellena con el usuario de la sesión, y la política de `insert`
solo admite el propio `auth.uid()` (o cualquiera, si eres admin): un gestor no
puede crear un expediente a nombre de otro ni robarse uno ajeno cambiando el
campo.

---

## Qué está cerrado, exactamente

Comprobado contra la API real, no solo en la interfaz:

| Prueba | Resultado |
|---|---|
| Gestor lee expediente de otro gestor | sin filas |
| Gestor modifica expediente de otro | 0 filas afectadas |
| Gestor se autoasigna un expediente ajeno | 0 filas afectadas |
| Gestor lee `password_hash` | `42501 permission denied` |
| Gestor lista usuarios | solo su propia ficha |
| Gestor firma un documento de otro | `404 not found` |
| `anon` lee expedientes | 0 filas |
| `anon` lee clientes | 0 filas |
| URL pública de un documento | `400` (bucket privado) |

El `password_hash` no se protege solo con RLS —que filtra filas, no
columnas— sino **revocando el privilegio de la columna**: `authenticated` tiene
`SELECT` sobre el resto de campos y ninguno sobre el hash.

### Documentos

El bucket `gestotrafic-docs` es **privado**. Cada enlace se **firma** al pintar
la pestaña de Documentación y caduca en una hora, y la política de
`storage.objects` comprueba la propiedad del expediente a partir de la ruta
(`<expediente_id>/<archivo>`). Un gestor no puede firmar la ruta de un
expediente que no es suyo aunque la conozca.

---

## Alta de gestores

El admin los crea desde **Gestores → + Nuevo gestor**. La creación va por la
Edge Function, que:

1. vuelve a comprobar en el servidor que quien llama es admin (no se fía del
   front),
2. crea la fila de sesión en `auth.users`,
3. hashea la contraseña con bcrypt,
4. inserta el perfil en `gestotrafic_usuarios`.

Si algo falla a medias, deshace el usuario de auth para no dejar huérfanos.

**No existe política de `insert` ni de `delete`** sobre `gestotrafic_usuarios`:
las altas solo pueden venir de la Edge Function con `service_role`. Desde el
navegador no hay forma de crearse un usuario ni de borrarse otro.

Los gestores no se borran, se **desactivan** (`activo = false`): un gestor
inactivo no puede iniciar sesión y sus expedientes se conservan para poder
reasignarlos.

---

## Objetos creados

- Tabla `gestotrafic_usuarios`
- Columna `gestotrafic_expedientes.gestor_id`
- Funciones `gestotrafic_rol()`, `gestotrafic_es_admin()` (RLS),
  `gestotrafic_hash_password()`, `gestotrafic_verificar_credenciales()`
  (solo `service_role`)
- Edge Function `gestotrafic-auth`

Todo sigue bajo el prefijo `gestotrafic_*`. La única dependencia fuera de él es
`auth.users`, que es la infraestructura de sesión de Supabase.

---

Hecho por **WhiteMoon Agencia IA** · whitemoon.es
