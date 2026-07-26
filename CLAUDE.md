# CLAUDE.md — GestoTrafic

CRM de demostración para gestorías de tráfico. HTML/CSS/JS puro sobre GitHub
Pages, con Supabase detrás (proyecto `mlaqtniujnvfxcvcourm`).

Documentación funcional en [`docs/`](docs/): [FASE-1](docs/FASE-1.md) ·
[TRAMITES](docs/TRAMITES.md) · [USUARIOS](docs/USUARIOS.md) ·
[GEST-IA](docs/GEST-IA.md).

---

## ⛔ Regla que manda sobre todas las demás

**Ningún dato fiscal se inventa.** Ni un precio medio del BOE, ni un valor
extraído de un documento, ni una versión "parecida" de un modelo.

Estos datos liquidan impuestos e inscriben cambios de titularidad ante la DGT.
**Un dato inventado que parece correcto hace más daño que un hueco vacío**,
porque el hueco se ve y el dato plausible no lo revisa nadie.

En la práctica:

- Si Gest-IA no lee un campo con claridad → `null` + confianza baja + resaltado.
- Si no hay precio medio para un vehículo → `sin_valor_boe` y se pide a mano.
- Si hay **varias** versiones posibles de un modelo → se devuelven todas y
  elige el gestor. Escoger una a ciegas entre dos precios distintos es inventar.

Si te falta una fuente de datos oficial, **para y pídela**. No la generes,
no la estimes, no la interpoles.

---

## Mantenimiento anual · precios medios del BOE

Cada año se publica una nueva **Orden HAC** con los precios medios de venta
(Anexo I) y la tabla de depreciación (Anexo IV). Hay que actualizar **dos
sitios**, y son independientes:

### 1 · La tabla `gestotrafic_precios_medios` (Anexo I)

Es la que alimenta el valor base automático. La columna `orden_boe` dice de qué
Orden viene cada fila, así que conviven varias sin pisarse.

**Los tramos** (motos, quads, buggys) se cargan a mano; **los turismos** salen
del XML del BOE con el parser de [`data/boe/`](data/boe/), que documenta la
descarga y el volcado paso a paso.

```sql
-- a) Cargar las filas nuevas con su Orden. NO borres las viejas todavía:
--    un expediente abierto puede estar calculado con la anterior.
insert into gestotrafic_precios_medios
  (tipo_vehiculo, cilindrada_min, cilindrada_max, tramo_etiqueta,
   valor_base_euros, orden_boe, fuente)
values
  ('moto', 0, 50, 'Hasta 50 c.c.', 0000, 'HAC/XXXX/2026', 'BOE Anexo I 2027'),
  ...;

-- b) Comprobar el recuento contra la fuente ANTES de dar por buena la carga
select orden_boe, tipo_vehiculo, count(*)
from gestotrafic_precios_medios group by 1, 2 order by 1, 2;

-- c) Con la Orden nueva ya verificada, apuntar las búsquedas a ella. Es UN
--    solo sitio, y hasta que se cambie el CRM sigue liquidando con la vieja:
create or replace function gestotrafic_orden_vigente()
returns text language sql immutable as $$ select 'HAC/XXXX/2026'::text $$;

-- d) Solo cuando no quede ningún expediente abierto con la Orden anterior:
delete from gestotrafic_precios_medios where orden_boe = 'HAC/1501/2025';
```

> Todas las funciones de búsqueda y de catálogo filtran por
> `gestotrafic_orden_vigente()`, así que pueden convivir varias Órdenes en la
> tabla sin mezclarse. El precio de eso es que **cargar la nueva no la activa**:
> hay que cambiar esa función. Si se te olvida, el CRM sigue calculando con la
> Orden del año pasado sin avisar.

### 2 · La tabla de depreciación (Anexo IV) y los tipos autonómicos

Están **hardcodeados** en dos sitios que deben ir sincronizados:

| Dónde | Qué |
|---|---|
| `WHITEMOON-WEB/calculadora-itp/index.html` | Fuente de verdad fiscal del grupo |
| [`supabase/functions/gestotrafic-itp/index.ts`](supabase/functions/gestotrafic-itp/index.ts) | Copia verbatim para el CRM |

> ⚠️ **Nunca reescribas el motor de memoria.** Su fuente ya vive en el repo, así
> que edita ese fichero y despliégalo; si dudas de que el repo esté sincronizado
> con lo desplegado, exporta primero (`supabase functions download
> gestotrafic-itp`) y compara. Un dígito mal transcrito en la tabla de
> depreciación no lo detecta ningún test suelto: para eso está
> `tools/verificar-itp.js`.

**El orden importa: primero se actualiza la calculadora, luego se porta.** Y al
portar, se comparan los dos resultados con el mismo vehículo antes de dar por
buena la migración (ver *Verificación* abajo).

### Estado actual de la carga

| Tipo | Filas | Criterio | Origen |
|---|---|---|---|
| `moto` | 13 | tramo de cilindrada | `calculadora-itp` · `tablaMotosComb` |
| `moto_electrica` | 14 | tramo de kW | `calculadora-itp` · `tablaMotosElec` |
| `quad` | 12 | tramo de cilindrada | `calculadora-itp` · `tablaQuads` |
| `buggy` | 6 | tramo de cilindrada | `calculadora-itp` · `tablaBuggys` |
| `turismo` | **61.634** | marca / modelo / versión | XML del BOE · [`data/boe/`](data/boe/) |

Los turismos ya no piden el valor base a mano: se elige la versión en el
buscador del panel ITP y el valor sale del Anexo I. **El campo manual sigue
existiendo** como respaldo para lo que no esté en la tabla.

> **Las autocaravanas no están cargadas y no deben cargarse tal cual.** El
> Anexo I las lista aparte (tablas 112-188 del XML) y el **Anexo IV les aplica
> otra tabla de depreciación** —18 tramos hasta el 10 %, frente a los 13 de los
> turismos—. `gestotrafic-itp` solo implementa la de turismos, así que cargarlas
> sin añadir esa segunda tabla daría una cuota incorrecta.

### Por qué la versión la elige una persona

El BOE no descompone el modelo: publica una sola cadena «Modelo-Tipo» por fila.
La columna `modelo` de la tabla es **el primer token de esa cadena**, un
agrupador para que el desplegable no liste 61.634 opciones de golpe. **No es un
dato del BOE y no interviene en la valoración**: la identidad fiscal es
`denominacion`, verbatim.

Y no basta con el nombre: hay **5.107 denominaciones repetidas dentro de su
marca con precios distintos**. `CLIO 1.5 DCI Authentique 3p` existe con 48, 63 y
66 kW valiendo 10.500, 11.400 y 11.600 €. Por eso
`gestotrafic_buscar_valor_base` devuelve `encontrado = false` y **todos** los
candidatos cuando hay más de uno, y la UI manda la fila elegida por `id`
(`valor_base_id`) en vez de por nombre.

---

## Verificación obligatoria al tocar el motor fiscal

Cualquier cambio en `gestotrafic-itp` o en los precios se valida **comparando
contra la calculadora de producción** con el mismo vehículo. Está automatizado:

```bash
node tools/verificar-itp.js
# o, si WHITEMOON-WEB no está al lado:
node tools/verificar-itp.js ../WHITEMOON-WEB/calculadora-itp/index.html
```

El script **no reimplementa el cálculo**: extrae del `index.html` de producción
sus tablas y funciones reales y las ejecuta, así que la referencia se mueve sola
si producción cambia. Sale con código 1 ante cualquier discrepancia.

**Valor venal, base imponible y cuota tienen que coincidir al céntimo.** Si no
coinciden, no se mergea: se reporta la discrepancia.

Cubre 14 casos: los tres de referencia, el valor base automático de turismos y
de motos, las ramas fiscales (exención, cuota fija estándar y valenciana, ECO,
>15 CVf, uso especial) y los dos en que el motor **debe negarse a calcular**
(varias versiones posibles y sin match).

Casos de referencia verificados (Orden HAC/1501/2025):

| Caso | valor base | venal | ITP |
|---|---|---|---|
| Turismo, 2019, contrato 8.600 € | 19.800 € (manual) | 5.544,00 € | 344,00 € |
| Moto 600 cc, 2018 | 6.700 € (automático) | 1.608,00 € | 64,32 € |
| Moto eléctrica 11 kW, 2022 | 4.500 € (automático) | 2.115,00 € | 84,60 € |
| SEAT Ibiza 1.0 TSI Style (2021), Madrid | 13.600 € (Anexo I) | 5.304,00 € | 212,16 € |
| Tesla Model 3 Gran Autonomía RWD, Cataluña, etiqueta 0 | 48.300 € (Anexo I) | 18.837,00 € | 0,00 € |

Si además tocas las **tablas** de `gestotrafic-itp`, compáralas valor a valor
con las de producción antes de desplegar: un dígito mal transcrito en la
depreciación no lo detecta ningún caso suelto.

---

## Aislamiento y seguridad

- Todo vive bajo el prefijo `gestotrafic_*` / `gestia-*`. **Sin FK ni triggers**
  hacia `onboarding_clientes`, `rag_documentos`, `check_client_health` ni nada
  del sistema de producción.
- **API keys y `service_role` solo en Edge Functions.** El navegador nunca ve
  más que la clave publicable y su propio token de sesión.
- El acceso anónimo está cerrado: expedientes, documentos y clientes exigen
  sesión, y el bucket `gestotrafic-docs` es privado con enlaces firmados.
- `verify_jwt: true` solo garantiza que el token es del proyecto — **la clave
  anon también lo es**. Las funciones identifican además al usuario y comprueban
  su rol y la propiedad del expediente.

## Git

Rama + PR siempre, nunca push directo a `main`:

```bash
git checkout -b feat/descripcion
gh pr create --base main
gh pr merge --squash --delete-branch
```
