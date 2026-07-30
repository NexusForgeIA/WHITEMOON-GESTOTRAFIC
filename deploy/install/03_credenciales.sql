-- ============================================================
-- GestoTrafic · Credenciales de la gestoría (ICOGAM)
-- ------------------------------------------------------------
-- Guarda el certificado colegial y las claves/tokens que ICOGAM
-- otorga a la gestoría para operar en producción con el Colegio.
--
-- Idempotente: se puede volver a lanzar sin romper nada.
--
-- ⛔ MODELO DE SEGURIDAD — leer antes de tocar nada de aquí
--
-- 1 · Los secretos NO se guardan en claro. Llegan ya cifrados
--     (AES-256-GCM) desde la Edge Function `gestotrafic-credenciales`,
--     que es la única que tiene la clave de cifrado. Esa clave vive en
--     una variable de entorno de la función y NUNCA en la base de
--     datos: un volcado completo de Postgres no basta para descifrarlos.
--
-- 2 · Esta tabla tiene RLS activado y CERO políticas a propósito.
--     Sin política, `anon` y `authenticated` no pueden hacer select,
--     insert, update ni delete: la tabla es literalmente inalcanzable
--     desde el navegador. Solo el `service_role` la toca, y solo desde
--     la Edge Function. No añadas una política "de lectura para el
--     admin": eso convertiría los secretos en legibles desde el cliente
--     y se acabó el write-only.
--
-- 3 · Write-only. No hay ninguna vía —ni SQL ni HTTP— que devuelva un
--     secreto ya guardado. Se pueden REEMPLAZAR y BORRAR, no leer. Lo
--     único que sale son metadatos: si está configurado, cuándo, el
--     nombre del fichero y una pista de 4 caracteres para reconocer la
--     clave. La pista se guarda aparte, en claro, y por eso es corta.
--
-- 4 · Aislamiento entre gestorías: cada gestoría tiene SU PROPIO
--     proyecto Supabase (ver deploy/provision.sh), así que la
--     separación es física, no por fila. Dentro de la instalación, lo
--     que separa es el rol: solo el admin. Si algún día varias
--     gestorías compartieran base, aquí es donde entraría una columna
--     `gestoria_id` y su política; el resto del diseño no cambia.
-- ============================================================

-- ------------------------------------------------------------
-- 1 · Tabla
-- ------------------------------------------------------------
create table if not exists public.gestotrafic_credenciales (
  -- `clave` identifica el juego de credenciales. Hoy solo existe
  -- 'icogam'; es un unique para que el upsert no pueda duplicar fila.
  clave              text primary key,

  -- Certificado colegial (.p12/.pfx). Cifrado. `cert_nombre` es el
  -- nombre del fichero original: no es secreto y sirve para que el
  -- admin reconozca cuál subió.
  cert_cifrado       bytea,
  cert_nombre        text,
  cert_bytes         integer,
  cert_subido_at     timestamptz,

  -- Contraseña del certificado. Un .p12 sin su contraseña no sirve, y
  -- guardarla en un post-it al lado es peor que guardarla cifrada aquí.
  cert_pass_cifrada  bytea,

  -- Clave API y token de ICOGAM. `*_pista` son los 4 últimos
  -- caracteres, en claro, para que el admin distinga una clave de otra
  -- sin poder reconstruirla.
  api_key_cifrada    bytea,
  api_key_pista      text,
  token_cifrado      bytea,
  token_pista        text,

  actualizado_at     timestamptz not null default now(),
  actualizado_por    uuid references public.gestotrafic_usuarios(id) on delete set null
);

comment on table public.gestotrafic_credenciales is
  'Credenciales ICOGAM de la gestoría. Columnas *_cifrado/_cifrada: AES-256-GCM, '
  'la clave vive solo en la Edge Function gestotrafic-credenciales. RLS sin '
  'políticas a propósito: inalcanzable desde el cliente.';

-- ------------------------------------------------------------
-- 2 · RLS: activado y SIN políticas (ver punto 2 de la cabecera)
-- ------------------------------------------------------------
alter table public.gestotrafic_credenciales enable row level security;

-- `force` para que la tabla tampoco se salte el RLS si algún día su
-- propietario la consulta desde otra función SECURITY DEFINER.
alter table public.gestotrafic_credenciales force row level security;

-- Por si una versión anterior dejó políticas: se limpian.
drop policy if exists gestotrafic_credenciales_select on public.gestotrafic_credenciales;
drop policy if exists gestotrafic_credenciales_all    on public.gestotrafic_credenciales;

-- Ni anon ni authenticated tienen nada que hacer con esta tabla.
revoke all on public.gestotrafic_credenciales from anon, authenticated;
grant  all on public.gestotrafic_credenciales to   service_role;

-- ------------------------------------------------------------
-- 3 · Estado (metadatos, NUNCA secretos)
-- ------------------------------------------------------------
-- Solo el admin. Devuelve si cada pieza está puesta, cuándo y su pista.
-- SECURITY DEFINER porque la tabla es inalcanzable para `authenticated`;
-- el filtro de rol lo hace la propia función.
create or replace function public.gestotrafic_credenciales_estado()
returns table (
  cert_configurado      boolean,
  cert_nombre           text,
  cert_bytes            integer,
  cert_subido_at        timestamptz,
  cert_pass_configurada boolean,
  api_key_configurada   boolean,
  api_key_pista         text,
  token_configurado     boolean,
  token_pista           text,
  actualizado_at        timestamptz,
  actualizado_por       text,
  listo                 boolean
)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select
    c.cert_cifrado      is not null,
    c.cert_nombre,
    c.cert_bytes,
    c.cert_subido_at,
    c.cert_pass_cifrada is not null,
    c.api_key_cifrada   is not null,
    c.api_key_pista,
    c.token_cifrado     is not null,
    c.token_pista,
    c.actualizado_at,
    u.nombre,
    -- "Listo" = certificado + al menos una credencial de acceso. Es la
    -- condición que abre la operación en producción con el Colegio.
    (c.cert_cifrado is not null
      and (c.api_key_cifrada is not null or c.token_cifrado is not null))
  from public.gestotrafic_credenciales c
  left join public.gestotrafic_usuarios u on u.id = c.actualizado_por
  where c.clave = 'icogam'
    and public.gestotrafic_es_admin()
$$;

-- ------------------------------------------------------------
-- 4 · Gating
-- ------------------------------------------------------------
-- Un booleano y nada más. Lo puede llamar CUALQUIER usuario con sesión,
-- admin o gestor: el gestor no configura credenciales, pero tiene que
-- saber por qué la exportación está deshabilitada. No filtra nada —
-- decir "hay credenciales" no ayuda a obtenerlas.
create or replace function public.gestotrafic_credenciales_listo()
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select c.cert_cifrado is not null
        and (c.api_key_cifrada is not null or c.token_cifrado is not null)
     from public.gestotrafic_credenciales c
     where c.clave = 'icogam'),
    false)
$$;

-- ------------------------------------------------------------
-- 5 · Permisos de ejecución
-- ------------------------------------------------------------
revoke all on function public.gestotrafic_credenciales_estado() from public, anon;
revoke all on function public.gestotrafic_credenciales_listo()  from public, anon;

grant execute on function public.gestotrafic_credenciales_estado() to authenticated, service_role;
grant execute on function public.gestotrafic_credenciales_listo()  to authenticated, service_role;
