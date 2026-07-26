-- ============================================================
-- GestoTrafic · esquema consolidado
-- ------------------------------------------------------------
-- Equivale a las 22 migraciones `gestotrafic_*` aplicadas en el
-- proyecto de referencia (mlaqtniujnvfxcvcourm), en un solo
-- fichero y sin los pasos intermedios que luego se rehacen.
--
-- El DDL NO está escrito de memoria: sale de un volcado del
-- catálogo del proyecto real (pg_get_constraintdef, pg_indexes,
-- pg_policy, pg_get_functiondef). Los nombres de tablas,
-- funciones, índices y políticas son los que están desplegados.
--
-- IDEMPOTENTE: se puede aplicar sobre una base vacía o sobre una
-- que ya lo tenga. Las políticas se borran y se recrean, porque
-- Postgres no tiene `create policy if not exists`.
--
-- Requisitos del destino: un proyecto Supabase (usa los esquemas
-- `auth` y `storage` y los roles anon / authenticated /
-- service_role). No funciona en un Postgres pelado.
--
-- Aplicar:  psql "$DB_URL" -v ON_ERROR_STOP=1 -f 01_schema.sql
-- ============================================================

begin;

-- pgcrypto vive en el esquema `extensions` en Supabase; de ahí sale
-- crypt()/gen_salt() para las contraseñas.
create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------
-- 1 · Secuencia de referencias  EXP-AAAA-NNNN
-- ------------------------------------------------------------
create sequence if not exists public.gestotrafic_exp_seq;

-- ------------------------------------------------------------
-- 2 · Tablas
-- ------------------------------------------------------------

create table if not exists public.gestotrafic_clientes (
  id uuid default gen_random_uuid() not null,
  tipo text default 'particular'::text not null,
  nombre text not null,
  apellidos text,
  razon_social text,
  nif text not null,
  email text,
  telefono text,
  direccion text,
  cp text,
  ciudad text,
  provincia text,
  notas text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.gestotrafic_usuarios (
  id uuid not null,
  nombre text not null,
  usuario text not null,
  email text not null,
  password_hash text not null,
  rol text default 'gestor'::text not null,
  activo boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.gestotrafic_expedientes (
  id uuid default gen_random_uuid() not null,
  referencia text default ((('EXP-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('gestotrafic_exp_seq'::regclass))::text, 4, '0'::text)) not null,
  cliente_id uuid,
  tipo_tramite text default 'transferencia'::text not null,
  estado text default 'nuevo'::text not null,
  marca text,
  modelo text,
  matricula text,
  fecha_matriculacion date,
  combustible text,
  cilindrada integer,
  cvf numeric,
  etiqueta_dgt text,
  valor_boe numeric,
  precio_contrato numeric,
  ccaa text,
  uso_especial boolean default false not null,
  vendedor_nombre text,
  vendedor_nif text,
  vendedor_direccion text,
  vendedor_telefono text,
  comprador_nombre text,
  comprador_nif text,
  comprador_direccion text,
  comprador_telefono text,
  valor_venal numeric,
  base_imponible numeric,
  itp_importe numeric,
  tasa_dgt numeric,
  total_impuestos numeric,
  calculo_json jsonb,
  calculado_at timestamp with time zone,
  notas text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  datos jsonb default '{}'::jsonb not null,
  titular_nombre text,
  titular_nif text,
  titular_direccion text,
  titular_telefono text,
  gestor_id uuid,
  ia_estado text,
  ia_extraccion jsonb,
  ia_modelo text,
  ia_validado_por uuid,
  ia_validado_at timestamp with time zone
);

create table if not exists public.gestotrafic_documentos (
  id uuid default gen_random_uuid() not null,
  expediente_id uuid not null,
  tipo text not null,
  estado text default 'pendiente'::text not null,
  nombre_archivo text,
  storage_path text,
  mime text,
  tamano integer,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.gestotrafic_precios_medios (
  id uuid default gen_random_uuid() not null,
  tipo_vehiculo text not null,
  marca text,
  modelo text,
  denominacion text,
  periodo_desde smallint,
  periodo_hasta smallint,
  cilindrada integer,
  cvf numeric(6,2),
  combustible text,
  cilindrada_min integer,
  cilindrada_max integer,
  potencia_kw_min numeric(7,2),
  potencia_kw_max numeric(7,2),
  tramo_etiqueta text,
  valor_base_euros numeric(10,2) not null,
  orden_boe text not null,
  fuente text,
  created_at timestamp with time zone default now() not null,
  num_cilindros smallint,
  potencia_kw numeric,
  potencia_cv integer
);

-- ------------------------------------------------------------
-- 3 · Restricciones
-- ------------------------------------------------------------
-- `add constraint if not exists` no existe en Postgres, así que cada
-- una se añade solo si falta.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('gestotrafic_clientes','gestotrafic_clientes_pkey','PRIMARY KEY (id)'),
      ('gestotrafic_clientes','gestotrafic_clientes_tipo_check',
       'CHECK ((tipo = ANY (ARRAY[''particular''::text, ''empresa''::text])))'),

      ('gestotrafic_usuarios','gestotrafic_usuarios_pkey','PRIMARY KEY (id)'),
      ('gestotrafic_usuarios','gestotrafic_usuarios_email_key','UNIQUE (email)'),
      ('gestotrafic_usuarios','gestotrafic_usuarios_usuario_key','UNIQUE (usuario)'),
      ('gestotrafic_usuarios','gestotrafic_usuarios_id_fkey',
       'FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE'),
      ('gestotrafic_usuarios','gestotrafic_usuarios_rol_check',
       'CHECK ((rol = ANY (ARRAY[''admin''::text, ''gestor''::text])))'),

      ('gestotrafic_expedientes','gestotrafic_expedientes_pkey','PRIMARY KEY (id)'),
      ('gestotrafic_expedientes','gestotrafic_expedientes_referencia_key','UNIQUE (referencia)'),
      ('gestotrafic_expedientes','gestotrafic_expedientes_cliente_id_fkey',
       'FOREIGN KEY (cliente_id) REFERENCES gestotrafic_clientes(id) ON DELETE SET NULL'),
      ('gestotrafic_expedientes','gestotrafic_expedientes_gestor_id_fkey',
       'FOREIGN KEY (gestor_id) REFERENCES gestotrafic_usuarios(id) ON DELETE SET NULL'),
      ('gestotrafic_expedientes','gestotrafic_expedientes_ia_validado_por_fkey',
       'FOREIGN KEY (ia_validado_por) REFERENCES gestotrafic_usuarios(id) ON DELETE SET NULL'),
      ('gestotrafic_expedientes','gestotrafic_expedientes_estado_check',
       'CHECK ((estado = ANY (ARRAY[''nuevo''::text, ''documentacion''::text, ''tramitacion''::text, ''presentado''::text, ''completado''::text])))'),
      ('gestotrafic_expedientes','gestotrafic_expedientes_ia_estado_check',
       'CHECK ((ia_estado = ANY (ARRAY[''pendiente_validacion''::text, ''validado''::text])))'),

      ('gestotrafic_documentos','gestotrafic_documentos_pkey','PRIMARY KEY (id)'),
      ('gestotrafic_documentos','gestotrafic_documentos_expediente_id_fkey',
       'FOREIGN KEY (expediente_id) REFERENCES gestotrafic_expedientes(id) ON DELETE CASCADE'),
      ('gestotrafic_documentos','gestotrafic_documentos_estado_check',
       'CHECK ((estado = ANY (ARRAY[''pendiente''::text, ''recibido''::text])))'),

      ('gestotrafic_precios_medios','gestotrafic_precios_medios_pkey','PRIMARY KEY (id)'),
      ('gestotrafic_precios_medios','gestotrafic_precios_medios_valor_base_euros_check',
       'CHECK ((valor_base_euros > (0)::numeric))'),
      ('gestotrafic_precios_medios','gestotrafic_precios_medios_tipo_vehiculo_check',
       'CHECK ((tipo_vehiculo = ANY (ARRAY[''turismo''::text, ''autocaravana''::text, ''moto''::text, ''moto_electrica''::text, ''quad''::text, ''buggy''::text])))'),
      -- La identificación no depende de "ser turismo" sino de CÓMO tarifa el
      -- anexo: por modelo (marca+modelo, sin tramos) o por tramo (sin marca).
      ('gestotrafic_precios_medios','gestotrafic_precios_identificacion',
       'CHECK ((((tipo_vehiculo = ANY (ARRAY[''turismo''::text, ''autocaravana''::text])) AND (marca IS NOT NULL) AND (modelo IS NOT NULL) AND (cilindrada_min IS NULL) AND (potencia_kw_min IS NULL)) OR ((tipo_vehiculo <> ALL (ARRAY[''turismo''::text, ''autocaravana''::text])) AND (marca IS NULL) AND (modelo IS NULL) AND ((cilindrada_min IS NOT NULL) OR (potencia_kw_min IS NOT NULL)))))')
    ) as t(tabla, nombre, definicion)
  loop
    if not exists (select 1 from pg_constraint where conname = r.nombre) then
      execute format('alter table public.%I add constraint %I %s', r.tabla, r.nombre, r.definicion);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 4 · Funciones auxiliares
--     `gestotrafic_normalizar_busqueda` va antes que los índices
--     porque uno de ellos la usa en su expresión.
-- ------------------------------------------------------------

-- Rol del usuario de la sesión. SECURITY DEFINER a propósito: las
-- políticas la llaman desde dentro de gestotrafic_usuarios y sin esto
-- se produciría una recursión con el propio RLS.
create or replace function public.gestotrafic_rol()
returns text language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select rol from public.gestotrafic_usuarios where id = auth.uid() and activo
$$;

create or replace function public.gestotrafic_es_admin()
returns boolean language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(public.gestotrafic_rol() = 'admin', false)
$$;

-- bcrypt, coste 10. Solo la llama gestotrafic-auth con service_role.
create or replace function public.gestotrafic_hash_password(p_password text)
returns text language sql security definer
set search_path to 'extensions', 'pg_temp'
as $$
  select crypt(p_password, gen_salt('bf', 10))
$$;

create or replace function public.gestotrafic_verificar_credenciales(p_usuario text, p_password text)
returns table(id uuid, nombre text, usuario text, email text, rol text)
language sql stable security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
  select u.id, u.nombre, u.usuario, u.email, u.rol
  from public.gestotrafic_usuarios u
  where lower(u.usuario) = lower(trim(p_usuario))
    and u.activo
    and u.password_hash = crypt(p_password, u.password_hash)
$$;

-- Normaliza un término de búsqueda: mayúsculas y solo alfanuméricos, para
-- que "4821 NBH", "4821-NBH" y "4821nbh" sean lo mismo. Matrículas y
-- documentos son ASCII. IMMUTABLE para poder indexarla.
create or replace function public.gestotrafic_normalizar_busqueda(p text)
returns text language sql immutable strict as $$
  select regexp_replace(upper(p), '[^A-Z0-9]', '', 'g');
$$;

-- Orden del BOE vigente. ÚNICO sitio que hay que tocar en la recarga
-- anual: mientras conviven dos Órdenes en la tabla, una búsqueda sin
-- filtrar devolvería filas de las dos.
create or replace function public.gestotrafic_orden_vigente()
returns text language sql immutable as $$ select 'HAC/1501/2025'::text $$;

-- ------------------------------------------------------------
-- 5 · Índices
-- ------------------------------------------------------------
create index if not exists gestotrafic_exp_cliente_idx
  on public.gestotrafic_expedientes using btree (cliente_id);
create index if not exists gestotrafic_exp_estado_idx
  on public.gestotrafic_expedientes using btree (estado);
create index if not exists gestotrafic_exp_tipo_idx
  on public.gestotrafic_expedientes using btree (tipo_tramite);
create index if not exists gestotrafic_expedientes_gestor_idx
  on public.gestotrafic_expedientes using btree (gestor_id);
create index if not exists gestotrafic_expedientes_ia_estado_idx
  on public.gestotrafic_expedientes using btree (ia_estado) where (ia_estado is not null);
create index if not exists gestotrafic_exp_matricula_norm_idx
  on public.gestotrafic_expedientes using btree (public.gestotrafic_normalizar_busqueda(matricula))
  where (matricula is not null);

create index if not exists gestotrafic_doc_exp_idx
  on public.gestotrafic_documentos using btree (expediente_id);

create index if not exists gestotrafic_precios_marca_modelo_idx
  on public.gestotrafic_precios_medios using btree (tipo_vehiculo, lower(marca), lower(modelo))
  where (tipo_vehiculo = any (array['turismo'::text, 'autocaravana'::text]));
create index if not exists gestotrafic_precios_tramo_idx
  on public.gestotrafic_precios_medios using btree (tipo_vehiculo, cilindrada_min, cilindrada_max)
  where (tipo_vehiculo <> all (array['turismo'::text, 'autocaravana'::text]));
create index if not exists gestotrafic_precios_orden_idx
  on public.gestotrafic_precios_medios using btree (orden_boe);

-- ------------------------------------------------------------
-- 6 · Funciones de negocio
-- ------------------------------------------------------------

/* Valor base del Anexo I para lo que tarifa por modelo (turismos y
   autocaravanas). Devuelve TODOS los candidatos cuando hay varios: NO
   elige entre dos precios distintos, porque dos versiones del mismo
   modelo pueden separarse por más de mil euros. Sin match, una fila con
   encontrado=false y candidatos=0.

   El tipo forma parte de la búsqueda: una fila de autocaravana pedida
   como turismo no debe aparecer, porque se deprecia con otra tabla del
   Anexo IV. */
create or replace function public.gestotrafic_buscar_valor_base(
  p_marca               text default null,
  p_modelo              text default null,
  p_version             text default null,
  p_fecha_matriculacion date default null,
  p_id                  uuid default null,
  p_tipo_vehiculo       text default 'turismo'
)
returns table (
  encontrado boolean, candidatos integer, id uuid,
  tipo_vehiculo text, marca text, modelo text, denominacion text,
  periodo_desde smallint, periodo_hasta smallint,
  cilindrada integer, num_cilindros smallint, combustible text,
  potencia_kw numeric, cvf numeric, potencia_cv integer,
  valor_base numeric, orden_boe text
)
language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  with cand as (
    select pm.*
    from public.gestotrafic_precios_medios pm
    where pm.tipo_vehiculo = coalesce(nullif(trim(p_tipo_vehiculo), ''), 'turismo')
      and pm.orden_boe = public.gestotrafic_orden_vigente()
      and (
        (p_id is not null and pm.id = p_id)
        or (p_id is null
            and p_marca is not null and p_modelo is not null
            and lower(pm.marca)  = lower(trim(p_marca))
            and lower(pm.modelo) = lower(trim(p_modelo))
            and (p_version is null or pm.denominacion ilike '%' || trim(p_version) || '%')
            and (p_fecha_matriculacion is null
                 or ((pm.periodo_desde is null
                      or extract(year from p_fecha_matriculacion)::smallint >= pm.periodo_desde)
                 and (pm.periodo_hasta is null
                      or extract(year from p_fecha_matriculacion)::smallint <= pm.periodo_hasta))))
      )
  ), n as (select count(*)::integer as total from cand)
  select (n.total = 1), n.total, c.id, c.tipo_vehiculo, c.marca, c.modelo,
         c.denominacion, c.periodo_desde, c.periodo_hasta, c.cilindrada,
         c.num_cilindros, c.combustible, c.potencia_kw, c.cvf, c.potencia_cv,
         c.valor_base_euros, c.orden_boe
  from n left join cand c on true
  order by c.periodo_desde desc nulls last, c.denominacion, c.potencia_kw;
$function$;

/* Motos, quads y buggys: el Anexo I los tarifa por TRAMO de cilindrada
   o de kW, así que no hay versiones que elegir. */
create or replace function public.gestotrafic_buscar_valor_base_tramo(
  p_tipo_vehiculo text,
  p_cilindrada integer default null,
  p_potencia_kw numeric default null
)
returns table (
  encontrado boolean, id uuid, tipo_vehiculo text,
  tramo_etiqueta text, valor_base numeric, orden_boe text
)
language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  with m as (
    select pm.*
    from public.gestotrafic_precios_medios pm
    where pm.tipo_vehiculo = p_tipo_vehiculo
      and pm.tipo_vehiculo <> 'turismo'
      and (
        (pm.potencia_kw_min is not null and p_potencia_kw is not null
          and p_potencia_kw >= pm.potencia_kw_min
          and (pm.potencia_kw_max is null or p_potencia_kw <= pm.potencia_kw_max))
        or
        (pm.cilindrada_min is not null and p_cilindrada is not null
          and p_cilindrada >= pm.cilindrada_min
          and (pm.cilindrada_max is null or p_cilindrada <= pm.cilindrada_max))
      )
    limit 1
  )
  select true, m.id, m.tipo_vehiculo, m.tramo_etiqueta, m.valor_base_euros, m.orden_boe from m
  union all
  select false, null::uuid, null::text, null::text, null::numeric, null::text
  where not exists (select 1 from m);
$function$;

-- Catálogo para los desplegables marca → modelo → versión.
create or replace function public.gestotrafic_precios_marcas(p_tipo_vehiculo text default 'turismo')
returns table (marca text, filas bigint)
language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  select pm.marca, count(*)
  from public.gestotrafic_precios_medios pm
  where pm.tipo_vehiculo = coalesce(nullif(trim(p_tipo_vehiculo), ''), 'turismo')
    and pm.orden_boe = public.gestotrafic_orden_vigente()
  group by pm.marca
  order by pm.marca;
$$;

create or replace function public.gestotrafic_precios_modelos(
  p_marca text, p_tipo_vehiculo text default 'turismo')
returns table (modelo text, filas bigint)
language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  -- El BOE escribe el mismo modelo con distinta caja ("MEGANE"/"Megane"), y
  -- `modelo` solo sirve para navegar: se agrupa sin distinguirla y se etiqueta
  -- con la grafía más frecuente del BOE, nunca con una inventada.
  select (array_agg(pm.modelo order by pm.n desc, pm.modelo))[1], sum(pm.n)
  from (
    select modelo, count(*) n
    from public.gestotrafic_precios_medios
    where tipo_vehiculo = coalesce(nullif(trim(p_tipo_vehiculo), ''), 'turismo')
      and orden_boe = public.gestotrafic_orden_vigente()
      and lower(marca) = lower(trim(p_marca))
    group by modelo
  ) pm
  group by lower(pm.modelo)
  order by 1;
$$;

create or replace function public.gestotrafic_precios_versiones(
  p_marca               text,
  p_modelo              text,
  p_fecha_matriculacion date default null,
  p_tipo_vehiculo       text default 'turismo')
returns table (
  id uuid, denominacion text,
  periodo_desde smallint, periodo_hasta smallint,
  cilindrada integer, num_cilindros smallint, combustible text,
  potencia_kw numeric, cvf numeric, potencia_cv integer,
  valor_base_euros numeric, en_periodo boolean)
language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  select pm.id, pm.denominacion, pm.periodo_desde, pm.periodo_hasta,
         pm.cilindrada, pm.num_cilindros, pm.combustible,
         pm.potencia_kw, pm.cvf, pm.potencia_cv, pm.valor_base_euros,
         -- No se filtra por fecha: se marca. Una ficha con la fecha mal leída
         -- no debe esconder la versión correcta, solo dejar de sugerirla.
         (p_fecha_matriculacion is null
          or ((pm.periodo_desde is null
               or extract(year from p_fecha_matriculacion)::smallint >= pm.periodo_desde)
          and (pm.periodo_hasta is null
               or extract(year from p_fecha_matriculacion)::smallint <= pm.periodo_hasta)))
  from public.gestotrafic_precios_medios pm
  where pm.tipo_vehiculo = coalesce(nullif(trim(p_tipo_vehiculo), ''), 'turismo')
    and pm.orden_boe = public.gestotrafic_orden_vigente()
    and lower(pm.marca)  = lower(trim(p_marca))
    and lower(pm.modelo) = lower(trim(p_modelo))
  order by pm.denominacion, pm.periodo_desde desc nulls last, pm.potencia_kw;
$$;

/* Busca expedientes por matrícula o por DNI/NIF/CIF.

   SECURITY INVOKER a propósito (es el modo por defecto: NO lleva SECURITY
   DEFINER). Así la consulta se ejecuta con los permisos de quien llama y el
   RLS de gestotrafic_expedientes hace el filtrado que ya hace en todo el CRM:
   un gestor solo encuentra los suyos, el admin todos. El filtro no se
   reimplementa aquí, que sería una segunda copia de la regla. */
create or replace function public.gestotrafic_buscar_expedientes(p_termino text)
returns table (
  id uuid, referencia text, matricula text, marca text, modelo text,
  tipo_tramite text, estado text, cliente text, coincide_en text
)
language sql stable
set search_path to 'public', 'pg_temp'
as $$
  with t as (
    select public.gestotrafic_normalizar_busqueda(coalesce(p_termino, '')) q
  ),
  campos as (
    select e.id, e.referencia, e.matricula, e.marca, e.modelo,
           e.tipo_tramite, e.estado,
           coalesce(
             nullif(trim(coalesce(c.razon_social, '')), ''),
             nullif(trim(concat_ws(' ', c.nombre, c.apellidos)), ''),
             nullif(trim(coalesce(e.comprador_nombre, '')), ''),
             nullif(trim(coalesce(e.titular_nombre, '')), '')
           ) cliente,
           public.gestotrafic_normalizar_busqueda(coalesce(e.matricula, '')) n_matricula,
           public.gestotrafic_normalizar_busqueda(
             concat_ws(' ', e.titular_nif, e.vendedor_nif, e.comprador_nif, c.nif)) n_nif,
           -- Lo que viva en el jsonb `datos` bajo una clave de matrícula o de
           -- documento también cuenta: hay trámites sin columna propia.
           coalesce((
             select string_agg(public.gestotrafic_normalizar_busqueda(d.value #>> '{}'), ' ')
             from jsonb_each(coalesce(e.datos, '{}'::jsonb)) d
             where jsonb_typeof(d.value) = 'string'
               and d.key ~* '(matricula|nif|dni|cif)'
           ), '') n_datos
    from public.gestotrafic_expedientes e
    left join public.gestotrafic_clientes c on c.id = e.cliente_id
  )
  select f.id, f.referencia, f.matricula, f.marca, f.modelo,
         f.tipo_tramite, f.estado, f.cliente,
         case
           when f.n_matricula <> '' and f.n_matricula like '%' || t.q || '%' then 'matricula'
           when f.n_nif <> ''       and f.n_nif       like '%' || t.q || '%' then 'documento'
           else 'datos'
         end
  from campos f, t
  where length(t.q) >= 3
    and (
      (f.n_matricula <> '' and f.n_matricula like '%' || t.q || '%')
      or (f.n_nif      <> '' and f.n_nif      like '%' || t.q || '%')
      or (f.n_datos    <> '' and f.n_datos    like '%' || t.q || '%')
    )
  order by f.referencia desc
  limit 50;
$$;

-- ------------------------------------------------------------
-- 7 · RLS y políticas
-- ------------------------------------------------------------
alter table public.gestotrafic_clientes       enable row level security;
alter table public.gestotrafic_usuarios       enable row level security;
alter table public.gestotrafic_expedientes    enable row level security;
alter table public.gestotrafic_documentos     enable row level security;
alter table public.gestotrafic_precios_medios enable row level security;

-- Postgres no tiene `create policy if not exists`: se borra y se recrea.
drop policy if exists gestotrafic_clientes_todos      on public.gestotrafic_clientes;
drop policy if exists gestotrafic_usuarios_select     on public.gestotrafic_usuarios;
drop policy if exists gestotrafic_usuarios_update     on public.gestotrafic_usuarios;
drop policy if exists gestotrafic_expedientes_select  on public.gestotrafic_expedientes;
drop policy if exists gestotrafic_expedientes_insert  on public.gestotrafic_expedientes;
drop policy if exists gestotrafic_expedientes_update  on public.gestotrafic_expedientes;
drop policy if exists gestotrafic_expedientes_delete  on public.gestotrafic_expedientes;
drop policy if exists gestotrafic_documentos_all      on public.gestotrafic_documentos;
drop policy if exists gestotrafic_precios_select      on public.gestotrafic_precios_medios;

create policy gestotrafic_clientes_todos on public.gestotrafic_clientes
  for all to authenticated using (true) with check (true);

-- El gestor se ve a sí mismo; el admin, a todos.
create policy gestotrafic_usuarios_select on public.gestotrafic_usuarios
  for select to authenticated
  using ((id = auth.uid()) or public.gestotrafic_es_admin());
create policy gestotrafic_usuarios_update on public.gestotrafic_usuarios
  for update to authenticated
  using (public.gestotrafic_es_admin()) with check (public.gestotrafic_es_admin());

-- Aislamiento por gestor. Es la regla de la que dependen el buscador y las
-- Edge Functions: ninguno la reimplementa, todos se apoyan en ella.
create policy gestotrafic_expedientes_select on public.gestotrafic_expedientes
  for select to authenticated
  using (public.gestotrafic_es_admin() or (gestor_id = auth.uid()));
create policy gestotrafic_expedientes_insert on public.gestotrafic_expedientes
  for insert to authenticated
  with check (public.gestotrafic_es_admin() or (gestor_id = auth.uid()));
create policy gestotrafic_expedientes_update on public.gestotrafic_expedientes
  for update to authenticated
  using (public.gestotrafic_es_admin() or (gestor_id = auth.uid()))
  with check (public.gestotrafic_es_admin() or (gestor_id = auth.uid()));
create policy gestotrafic_expedientes_delete on public.gestotrafic_expedientes
  for delete to authenticated
  using (public.gestotrafic_es_admin() or (gestor_id = auth.uid()));

create policy gestotrafic_documentos_all on public.gestotrafic_documentos
  for all to authenticated
  using (exists (select 1 from public.gestotrafic_expedientes e
                 where e.id = gestotrafic_documentos.expediente_id
                   and (public.gestotrafic_es_admin() or e.gestor_id = auth.uid())))
  with check (exists (select 1 from public.gestotrafic_expedientes e
                 where e.id = gestotrafic_documentos.expediente_id
                   and (public.gestotrafic_es_admin() or e.gestor_id = auth.uid())));

-- Los precios medios son públicos del BOE: los lee cualquier gestor con sesión.
create policy gestotrafic_precios_select on public.gestotrafic_precios_medios
  for select to authenticated using (true);

-- ------------------------------------------------------------
-- 8 · Permisos
--     El acceso anónimo está cerrado: sin sesión no se ve nada.
-- ------------------------------------------------------------
revoke all on public.gestotrafic_clientes    from anon;
revoke all on public.gestotrafic_expedientes from anon;
revoke all on public.gestotrafic_documentos  from anon;
revoke all on public.gestotrafic_usuarios    from anon, authenticated;
revoke all on public.gestotrafic_precios_medios from anon, authenticated;

grant select, insert, update, delete on public.gestotrafic_clientes    to authenticated;
grant select, insert, update, delete on public.gestotrafic_expedientes to authenticated;
grant select, insert, update, delete on public.gestotrafic_documentos  to authenticated;
grant select on public.gestotrafic_precios_medios to authenticated;

-- `password_hash` NO se concede: el RLS filtra filas, no columnas, y sin este
-- grant por columna un gestor no puede leer el hash ni siquiera de su propia
-- ficha. Es la segunda barrera, no la única.
grant select (id, nombre, usuario, email, rol, activo, created_at, updated_at)
  on public.gestotrafic_usuarios to authenticated;
grant update (nombre, rol, activo, updated_at)
  on public.gestotrafic_usuarios to authenticated;

grant usage, select on sequence public.gestotrafic_exp_seq to authenticated, service_role;

-- Las búsquedas del Anexo I solo las usa el servidor (Edge Functions con
-- service_role); el navegador usa las de catálogo.
revoke execute on function public.gestotrafic_buscar_valor_base(text, text, text, date, uuid, text) from public, anon;
revoke execute on function public.gestotrafic_buscar_valor_base_tramo(text, integer, numeric) from public, anon;
revoke execute on function public.gestotrafic_precios_marcas(text) from public, anon;
revoke execute on function public.gestotrafic_precios_modelos(text, text) from public, anon;
revoke execute on function public.gestotrafic_precios_versiones(text, text, date, text) from public, anon;
revoke execute on function public.gestotrafic_buscar_expedientes(text) from public, anon;
-- Contraseñas: solo el servidor.
revoke execute on function public.gestotrafic_hash_password(text) from public, anon, authenticated;
revoke execute on function public.gestotrafic_verificar_credenciales(text, text) from public, anon, authenticated;

grant execute on function public.gestotrafic_buscar_valor_base(text, text, text, date, uuid, text) to authenticated, service_role;
grant execute on function public.gestotrafic_buscar_valor_base_tramo(text, integer, numeric) to authenticated, service_role;
grant execute on function public.gestotrafic_precios_marcas(text) to authenticated, service_role;
grant execute on function public.gestotrafic_precios_modelos(text, text) to authenticated, service_role;
grant execute on function public.gestotrafic_precios_versiones(text, text, date, text) to authenticated, service_role;
grant execute on function public.gestotrafic_buscar_expedientes(text) to authenticated;
grant execute on function public.gestotrafic_es_admin() to authenticated, service_role;
grant execute on function public.gestotrafic_rol() to authenticated, service_role;
grant execute on function public.gestotrafic_hash_password(text) to service_role;
grant execute on function public.gestotrafic_verificar_credenciales(text, text) to service_role;

-- ------------------------------------------------------------
-- 9 · Bucket privado de documentos
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('gestotrafic-docs', 'gestotrafic-docs', false, 10485760)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- El primer tramo de la ruta es el id del expediente: así la propiedad del
-- archivo se comprueba contra el mismo RLS que el expediente.
drop policy if exists gestotrafic_docs_read   on storage.objects;
drop policy if exists gestotrafic_docs_insert on storage.objects;
drop policy if exists gestotrafic_docs_update on storage.objects;
drop policy if exists gestotrafic_docs_delete on storage.objects;

create policy gestotrafic_docs_read on storage.objects
  for select to authenticated
  using (bucket_id = 'gestotrafic-docs' and exists (
    select 1 from public.gestotrafic_expedientes e
    where e.id::text = (storage.foldername(objects.name))[1]
      and (public.gestotrafic_es_admin() or e.gestor_id = auth.uid())));

create policy gestotrafic_docs_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'gestotrafic-docs' and exists (
    select 1 from public.gestotrafic_expedientes e
    where e.id::text = (storage.foldername(objects.name))[1]
      and (public.gestotrafic_es_admin() or e.gestor_id = auth.uid())));

-- Hace falta para el upsert al resubir un documento.
create policy gestotrafic_docs_update on storage.objects
  for update to authenticated
  using (bucket_id = 'gestotrafic-docs' and exists (
    select 1 from public.gestotrafic_expedientes e
    where e.id::text = (storage.foldername(objects.name))[1]
      and (public.gestotrafic_es_admin() or e.gestor_id = auth.uid())))
  with check (bucket_id = 'gestotrafic-docs' and exists (
    select 1 from public.gestotrafic_expedientes e
    where e.id::text = (storage.foldername(objects.name))[1]
      and (public.gestotrafic_es_admin() or e.gestor_id = auth.uid())));

create policy gestotrafic_docs_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'gestotrafic-docs' and exists (
    select 1 from public.gestotrafic_expedientes e
    where e.id::text = (storage.foldername(objects.name))[1]
      and (public.gestotrafic_es_admin() or e.gestor_id = auth.uid())));

commit;
