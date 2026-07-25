# Migraciones

Las migraciones del multiusuario están aplicadas en el proyecto Supabase
`mlaqtniujnvfxcvcourm` y quedan registradas allí. Se listan aquí por orden para
poder reconstruir el esquema desde cero:

| Orden | Nombre | Qué hace |
|---|---|---|
| 1 | `gestotrafic_usuarios_multiusuario` | Tabla `gestotrafic_usuarios`, columna `gestor_id`, helpers de rol y RLS de expedientes, documentos y usuarios |
| 2 | `gestotrafic_usuarios_bcrypt` | `gestotrafic_hash_password()` y `gestotrafic_verificar_credenciales()` con pgcrypto, restringidas a `service_role` |
| 3 | `gestotrafic_usuarios_bootstrap_demo` | Admin y dos gestores de arranque (`admin`, `gestor`, `marcos`) |
| 4 | `gestotrafic_cerrar_acceso_anonimo` | Clientes solo con sesión; bucket privado y políticas de Storage por propiedad |
| 5 | `gestotrafic_docs_update_policy` | Política de `update` en `storage.objects` (necesaria para el upsert al resubir un documento) |

Todo vive bajo el prefijo `gestotrafic_*`. La única referencia fuera de él es
`auth.users`, que sostiene la sesión (ver [`../../docs/USUARIOS.md`](../../docs/USUARIOS.md)).

> El esquema de la Fase 1 (clientes, expedientes, documentos, secuencia de
> referencias y bucket) es anterior a este repositorio y ya estaba aplicado.
