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
| 6 | `gestotrafic_gestia_intake` | Columnas de Gest-IA en expedientes: `ia_estado`, `ia_extraccion`, `ia_modelo`, `ia_validado_por`, `ia_validado_at` |

Todo vive bajo el prefijo `gestotrafic_*`. La única referencia fuera de él es
`auth.users`, que sostiene la sesión (ver [`../../docs/USUARIOS.md`](../../docs/USUARIOS.md)).

> El esquema de la Fase 1 (clientes, expedientes, documentos, secuencia de
> referencias y bucket) es anterior a este repositorio y ya estaba aplicado.
| 7 | `gestotrafic_precios_medios` | Tabla de precios medios del Anexo I (turismos por marca/modelo, resto por tramo) + RLS de solo lectura |
| 8 | `gestotrafic_precios_medios_carga_tramos` | Carga de los 45 tramos reales de motos, quads y buggys (Orden HAC/1501/2025) |
| 9 | `gestotrafic_buscar_valor_base` / `_fix` | Funciones de búsqueda del valor base; devuelven `encontrado=false` en vez de inventar |
