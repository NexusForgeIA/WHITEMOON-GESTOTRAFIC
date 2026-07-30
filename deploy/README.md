# Kit de replicación · instalar GestoTrafic en una gestoría

Todo lo necesario para levantar una instalación nueva de forma repetible.

```
deploy/
  provision.sh                      automatiza lo repetible
  install/
    01_schema.sql                   esquema consolidado, idempotente
    02_seed_precios_medios.sql      70.931 filas del Anexo I del BOE
    03_credenciales.sql             credenciales ICOGAM (cifradas, write-only)
    functions/README.md             dónde está el código de las Edge Functions
```

## Antes de lanzar nada

Cuatro cosas que **no** hace el script, con su motivo:

| Qué | Por qué a mano |
|---|---|
| Crear el proyecto Supabase | La organización, el plan y la región son decisiones de negocio y de coste. Se eligen en el panel |
| Conseguir las claves | Solo se leen desde el panel. Meterlas en el repo sería filtrarlas |
| Publicar el front-end | Cada cliente va en su propio repositorio de GitHub Pages |
| Dominio del cliente | Compra y DNS |

Con el proyecto ya creado, se exportan sus datos y se lanza el script:

```bash
export SUPABASE_ACCESS_TOKEN='sbp_...'      # Account → Access Tokens
export SUPABASE_DB_URL='postgresql://postgres.<ref>:<clave>@...pooler.supabase.com:5432/postgres'
export SUPABASE_SERVICE_ROLE_KEY='eyJ...'   # Project Settings → API Keys
export ANTHROPIC_API_KEY='sk-ant-...'       # opcional: solo para Gest-IA
export GESTOTRAFIC_CRED_KEY="$(openssl rand -base64 32)"   # cifra las credenciales ICOGAM

./deploy/provision.sh "Gestoría Martínez" abcdefghijklmnopqrst
```

Con `--dry-run` enseña todo lo que haría sin tocar nada.

Hace falta tener instalados `supabase` (CLI), `psql` y `curl`.

## Qué hace, en orden

1. **Enlaza** el proyecto (`supabase link`).
2. **Aplica el esquema**: 5 tablas, 21 restricciones, 18 índices, 12 funciones,
   RLS con 13 políticas y el bucket privado `gestotrafic-docs`.
3. **Carga los precios del BOE** y **comprueba que quedan 70.931 filas**. Si no
   cuadra, aborta: una tabla de precios incompleta da cuotas incorrectas sin
   avisar.
4. **Despliega las 4 Edge Functions** con su `verify_jwt` correcto.
5. **Pone `ANTHROPIC_API_KEY`** si la has exportado.
6. **Crea el primer administrador**, pidiendo la contraseña por teclado (no se
   muestra ni queda en el historial). Hace falta porque `gestotrafic-auth` solo
   deja crear usuarios a un admin que ya exista.

Es idempotente: se puede relanzar sobre una instalación a medias.

## Después

1. En `assets/js/config.js`, poner `SUPABASE_URL` y `SUPABASE_ANON_KEY` del
   proyecto nuevo, y el bloque `GESTORIA` (nombre y ciudad), que es lo que sale
   en el contrato de compraventa que genera el CRM.
2. Publicar el front y entrar como el administrador recién creado.
3. Dar de alta a los gestores desde **Gestores → Nuevo gestor**. Cada uno solo
   verá sus expedientes: lo impone el RLS del servidor, no la interfaz.

## Los precios del BOE

`02_seed_precios_medios.sql` no está escrito a mano ni recalculado:

- los **45 tramos** (motos, motos eléctricas, quads, buggys) son un export
  literal de `gestotrafic_precios_medios` del proyecto de referencia;
- las **70.886 filas** de turismos y autocaravanas salen de los TSV de
  [`data/boe/`](../data/boe/), que son el volcado verificado del XML del BOE y
  la fuente exacta con la que se cargó esa tabla.

Se regenera con `python tools/generar-seed-precios.py`, que además imprime los
agregados para poder contrastarlos con la tabla real.

El seed es **idempotente por Orden**: borra lo que hubiera de `HAC/1501/2025`
antes de cargar, y no toca las filas de otras Órdenes — un expediente abierto
puede estar calculado con la anterior.

> **Recarga anual.** Cada diciembre sale una Orden HAC nueva. El procedimiento
> está en [`data/boe/README.md`](../data/boe/README.md). Cargar la nueva **no la
> activa**: hay que apuntar `gestotrafic_orden_vigente()` a ella.

## Verificación tras instalar

```bash
# 1 · filas del Anexo I (lo comprueba ya el script)
psql "$SUPABASE_DB_URL" -c "select tipo_vehiculo, count(*) from gestotrafic_precios_medios group by 1 order by 1;"
# turismo 61634 · autocaravana 9252 · moto 13 · moto_electrica 14 · quad 12 · buggy 6

# 2 · el motor fiscal, contra la calculadora de producción
node tools/verificar-itp.js
```

`tools/verificar-itp.js` apunta al proyecto de referencia; para validar una
instalación nueva hay que cambiarle la URL. Comprueba 20 casos contra el código
real de `WHITEMOON-WEB/calculadora-itp`, incluidos los tres de referencia de
[`CLAUDE.md`](../CLAUDE.md).
