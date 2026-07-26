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
| 10 | `gestotrafic_precios_medios_columnas_turismo` | Añade `num_cilindros`, `potencia_kw` y `potencia_cv` (columnas reales del Anexo I) y retira `co2`, que el anexo no publica |
| 11 | `gestotrafic_buscar_valor_base_turismo` | `gestotrafic_orden_vigente()` + búsqueda con `p_id` para fijar una versión concreta, filtrada por la Orden vigente |
| 12 | `gestotrafic_precios_catalogo_turismo` | `..._marcas` / `..._modelos` / `..._versiones` para los desplegables, con `execute` solo para `authenticated` |
| 13 | `gestotrafic_buscar_valor_base_solo_servidor` | Cierra el `execute` de las funciones de búsqueda a `anon` (las usa la Edge Function con `service_role`) |
| 14 | `gestotrafic_precios_modelos_sin_duplicar_por_mayusculas` | El BOE escribe «MEGANE» y «Megane»: se agrupa sin distinguir caja para no ofrecer entradas duplicadas |
| 15 | `gestotrafic_precios_medios_autocaravana` | Admite `tipo_vehiculo = 'autocaravana'`; la restricción de identificación y los índices pasan a distinguir «tarifa por modelo» de «tarifa por tramo» |
| 16 | `gestotrafic_valor_base_por_tipo` | La búsqueda lleva `p_tipo_vehiculo`: un id de autocaravana pedido como turismo devuelve `sin_match` en vez de calcular con otra depreciación |
| 17 | `gestotrafic_precios_catalogo_por_tipo` | Las tres funciones de catálogo aceptan el tipo, para que cada buscador vea solo sus filas |

## Carga de las filas del Anexo I

Las filas que se tarifan por marca/modelo **no van en una migración**: se cargan
desde los TSV de [`data/boe/`](../../data/boe/), que son el volcado verificable
del XML del BOE.

| `tipo_vehiculo` | Filas | Fichero |
|---|---|---|
| `turismo` | 61.634 | `anexo1-turismos-2026.tsv` |
| `autocaravana` | 9.252 | `anexo1-autocaravanas-2026.tsv` |

Van separados **a propósito**: el Anexo IV los deprecia con tablas distintas
(13 tramos frente a 19). El procedimiento completo —descarga, parseo y recarga
anual— está en [`data/boe/README.md`](../../data/boe/README.md).

Las cargas se hicieron con la extensión `http` —instalada y **retirada** al
terminar— leyendo el TSV desde el repositorio y comprobando los agregados
(recuento, marcas, suma de importes, suma de kW y nulos por columna) contra el
fichero de origen.
