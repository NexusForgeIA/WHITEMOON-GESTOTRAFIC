#!/usr/bin/env bash
# ============================================================
# GestoTrafic · aprovisionamiento de una instalación nueva
# ------------------------------------------------------------
#   ./deploy/provision.sh <nombre-gestoria> <supabase-ref> [--dry-run]
#
# Automatiza lo repetible: enlazar el proyecto, aplicar el esquema,
# cargar los precios del BOE, desplegar las cuatro Edge Functions y
# poner el secreto de Anthropic. Al final crea el primer administrador,
# que es el único que puede dar de alta a los demás.
#
# Lo que NO automatiza —y por qué— está al final de este fichero y en
# deploy/README.md. Resumen: crear el proyecto Supabase y conseguir sus
# claves requiere pasar por el panel; ahí no se entra por script.
#
# Es IDEMPOTENTE: se puede volver a lanzar sobre una instalación a
# medias. El esquema y el seed lo son por diseño, y el alta del admin
# detecta si ya existe.
# ============================================================
set -euo pipefail

# ------------------------------------------------------------
# Argumentos
# ------------------------------------------------------------
DRY_RUN=0
ARGS=()
for a in "$@"; do
  case "$a" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) ARGS+=("$a") ;;
  esac
done

if [ "${#ARGS[@]}" -ne 2 ]; then
  echo "Uso: $0 <nombre-gestoria> <supabase-ref> [--dry-run]" >&2
  echo "Ej.: $0 'Gestoría Martínez' abcdefghijklmnopqrst" >&2
  exit 64
fi

GESTORIA="${ARGS[0]}"
REF="${ARGS[1]}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL="$RAIZ/deploy/install"
FUNCIONES="$RAIZ/supabase/functions"

# ------------------------------------------------------------
# Salida
# ------------------------------------------------------------
if [ -t 1 ]; then AZUL='\033[1;34m'; VERDE='\033[0;32m'; ROJO='\033[0;31m'; GRIS='\033[0;90m'; FIN='\033[0m'
else AZUL=''; VERDE=''; ROJO=''; GRIS=''; FIN=''; fi

paso()  { printf "\n${AZUL}▸ %s${FIN}\n" "$1"; }
ok()    { printf "  ${VERDE}✓${FIN} %s\n" "$1"; }
aviso() { printf "  ${GRIS}· %s${FIN}\n" "$1"; }
morir() { printf "\n${ROJO}✗ %s${FIN}\n" "$1" >&2; exit 1; }

# Ejecuta, o solo enseña el comando si es un simulacro.
correr() {
  if [ "$DRY_RUN" = 1 ]; then printf "  ${GRIS}[simulacro] %s${FIN}\n" "$*"; return 0; fi
  "$@"
}

# ------------------------------------------------------------
# 0 · Comprobaciones previas
# ------------------------------------------------------------
paso "Comprobaciones previas"

for cmd in supabase psql curl; do
  command -v "$cmd" >/dev/null 2>&1 || morir "Falta '$cmd'. Instálalo antes de seguir.
   supabase → https://supabase.com/docs/guides/cli
   psql     → cliente de PostgreSQL"
done
ok "supabase, psql y curl disponibles"

[ -f "$INSTALL/01_schema.sql" ] || morir "No encuentro $INSTALL/01_schema.sql"
[ -f "$INSTALL/02_seed_precios_medios.sql" ] || morir "No encuentro $INSTALL/02_seed_precios_medios.sql"
ok "artefactos de instalación presentes"

faltan=()
for v in SUPABASE_ACCESS_TOKEN SUPABASE_DB_URL SUPABASE_SERVICE_ROLE_KEY; do
  [ -n "${!v:-}" ] || faltan+=("$v")
done
if [ "${#faltan[@]}" -gt 0 ]; then
  morir "Faltan variables de entorno: ${faltan[*]}

  SUPABASE_ACCESS_TOKEN      Panel → Account → Access Tokens
  SUPABASE_DB_URL            Panel → Project Settings → Database → Connection string (URI)
                             Incluye la contraseña de la base de datos.
  SUPABASE_SERVICE_ROLE_KEY  Panel → Project Settings → API Keys
                             NO se guarda en el repo ni se pasa por argumento."
fi
ok "variables de entorno presentes"

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  aviso "ANTHROPIC_API_KEY no está definida: Gest-IA quedará sin configurar"
  aviso "el resto del CRM funciona igual; se puede poner después"
fi

printf "\n  Gestoría : %s\n  Proyecto : %s\n" "$GESTORIA" "$REF"
[ "$DRY_RUN" = 1 ] && printf "  ${GRIS}Modo simulacro: no se toca nada${FIN}\n"

if [ "$DRY_RUN" = 0 ]; then
  read -r -p "
¿Aplicar sobre este proyecto? [s/N] " confirma
  [[ "$confirma" =~ ^[sS]$ ]] || morir "Cancelado."
fi

# ------------------------------------------------------------
# 1 · Enlazar el proyecto
# ------------------------------------------------------------
paso "1/6 · Enlazando el proyecto $REF"
correr supabase link --project-ref "$REF"
ok "proyecto enlazado"

# ------------------------------------------------------------
# 2 · Esquema
# ------------------------------------------------------------
paso "2/6 · Aplicando el esquema"
correr psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -f "$INSTALL/01_schema.sql"
ok "tablas, índices, RLS, políticas, funciones y bucket privado"

# ------------------------------------------------------------
# 3 · Precios medios del BOE
# ------------------------------------------------------------
paso "3/6 · Cargando los precios medios del Anexo I"
aviso "son ~71.000 filas: puede tardar medio minuto"
correr psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -f "$INSTALL/02_seed_precios_medios.sql"

if [ "$DRY_RUN" = 0 ]; then
  filas=$(psql "$SUPABASE_DB_URL" -tAc \
    "select count(*) from public.gestotrafic_precios_medios where orden_boe = public.gestotrafic_orden_vigente();")
  [ "$filas" = "70931" ] || morir "El seed cargó $filas filas y se esperaban 70931. No sigas: el motor fiscal quedaría incompleto."
  ok "70.931 filas cargadas y verificadas"
else
  aviso "[simulacro] se comprobaría que quedan 70.931 filas"
fi

# ------------------------------------------------------------
# 4 · Edge Functions
# ------------------------------------------------------------
paso "4/6 · Desplegando las Edge Functions"

# gestotrafic-itp y gestotrafic-auth van sin verify_jwt: la primera es una
# calculadora sin datos personales y la segunda es el propio login, que aún
# no tiene sesión que verificar. Las demás SÍ la exigen.
desplegar() {
  local nombre="$1" verifica="$2"
  [ -f "$FUNCIONES/$nombre/index.ts" ] || morir "Falta el código de $nombre"
  if [ "$verifica" = "no" ]; then
    correr supabase functions deploy "$nombre" --project-ref "$REF" --no-verify-jwt
  else
    correr supabase functions deploy "$nombre" --project-ref "$REF"
  fi
  ok "$nombre (verify_jwt: $([ "$verifica" = "no" ] && echo off || echo on))"
}

desplegar gestotrafic-auth       no
desplegar gestotrafic-itp        no
desplegar gestia-extraer         si
desplegar gestotrafic-valor-base si
desplegar gestotrafic-expediente si

# ------------------------------------------------------------
# 5 · Secretos
# ------------------------------------------------------------
paso "5/6 · Secretos"
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  correr supabase secrets set --project-ref "$REF" "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY"
  ok "ANTHROPIC_API_KEY puesta (Gest-IA operativa)"
else
  aviso "sin ANTHROPIC_API_KEY: ponla luego con"
  aviso "  supabase secrets set --project-ref $REF ANTHROPIC_API_KEY=sk-ant-..."
fi
aviso "SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY las inyecta Supabase sola"

# ------------------------------------------------------------
# 6 · Primer administrador
# ------------------------------------------------------------
paso "6/6 · Primer administrador"
aviso "hace falta uno para poder dar de alta al resto: gestotrafic-auth"
aviso "solo deja crear usuarios a un admin que ya exista"

if [ "$DRY_RUN" = 1 ]; then
  aviso "[simulacro] se pediría usuario y contraseña del administrador"
else
  ya=$(psql "$SUPABASE_DB_URL" -tAc \
    "select count(*) from public.gestotrafic_usuarios where rol = 'admin';")
  if [ "$ya" != "0" ]; then
    ok "ya existe un administrador ($ya): no se toca"
  else
    read -r -p "  Usuario del administrador [admin]: " ADMIN_USER
    ADMIN_USER="${ADMIN_USER:-admin}"
    read -r -p "  Nombre completo [Administrador]: " ADMIN_NOMBRE
    ADMIN_NOMBRE="${ADMIN_NOMBRE:-Administrador}"
    # -s: la contraseña no se muestra ni queda en el historial del shell.
    read -r -s -p "  Contraseña: " ADMIN_PASS; echo
    [ -n "$ADMIN_PASS" ] || morir "La contraseña no puede quedar vacía."

    ADMIN_EMAIL="${ADMIN_USER}@gestotrafic.demo"
    URL_API="${SUPABASE_URL:-https://${REF}.supabase.co}"

    # El usuario de auth solo sostiene la sesión: su contraseña interna es
    # aleatoria y no la usa nadie. La real se guarda con bcrypt en
    # gestotrafic_usuarios, que es contra la que verifica el login.
    respuesta=$(curl -s -X POST "$URL_API/auth/v1/admin/users" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$(openssl rand -hex 32)\",\"email_confirm\":true}")

    UID_ADMIN=$(printf '%s' "$respuesta" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
    [ -n "$UID_ADMIN" ] || morir "No se pudo crear el usuario de auth. Respuesta: $respuesta"

    PGPASSWORD_UNUSED=1 psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q \
      -v uid="$UID_ADMIN" -v usuario="$ADMIN_USER" -v nombre="$ADMIN_NOMBRE" \
      -v email="$ADMIN_EMAIL" -v pass="$ADMIN_PASS" <<'SQL'
insert into public.gestotrafic_usuarios (id, nombre, usuario, email, password_hash, rol)
values (:'uid', :'nombre', :'usuario', :'email',
        public.gestotrafic_hash_password(:'pass'), 'admin');
SQL
    unset ADMIN_PASS
    ok "administrador '$ADMIN_USER' creado"
  fi
fi

# ------------------------------------------------------------
# Resumen
# ------------------------------------------------------------
cat <<RESUMEN

$(printf "${VERDE}Instalación de %s lista en el servidor.${FIN}" "$GESTORIA")

Queda por hacer a mano (y por qué):

  1. Front-end · assets/js/config.js
     Poner SUPABASE_URL y SUPABASE_ANON_KEY del proyecto $REF.
     No se automatiza porque el front se publica en GitHub Pages desde
     otro repositorio por cliente: el despliegue lo decide quien lo aloja.

  2. Personalizar GESTORIA en assets/js/config.js
     nombre: '$GESTORIA'  ·  ciudad: '...'
     Es lo que sale en el contrato de compraventa que genera el CRM.

  3. Dar de alta a los gestores
     Desde el propio CRM: entrar como '$ADMIN_USER' → Gestores → Nuevo gestor.
     Cada uno solo verá sus expedientes (lo impone el RLS, no la interfaz).

Lo que este script NO puede hacer, por si te lo preguntas:

  · Crear el proyecto Supabase. La API de gestión permite crearlo, pero
    la organización, el plan y la región son decisiones de negocio y de
    coste: se eligen en el panel, no en un script.
  · Sacar las claves del proyecto. Solo se leen desde el panel o con un
    token de gestión; ponerlas aquí sería dejarlas en un fichero.
  · Comprar y apuntar el dominio del cliente.

RESUMEN
