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

-- c) Cuando la Orden nueva esté verificada, apuntar las funciones de búsqueda
--    a ella (constante ORDEN_VIGENTE en las funciones) o retirar la vieja:
delete from gestotrafic_precios_medios where orden_boe = 'HAC/1501/2025';
```

> Las funciones `gestotrafic_buscar_valor_base*` hoy no filtran por Orden porque
> solo hay una cargada. **Al cargar la segunda hay que añadir el filtro**, o
> devolverán filas de las dos y el resultado dependerá del orden del índice.

### 2 · La tabla de depreciación (Anexo IV) y los tipos autonómicos

Están **hardcodeados** en dos sitios que deben ir sincronizados:

| Dónde | Qué |
|---|---|
| `WHITEMOON-WEB/calculadora-itp/index.html` | Fuente de verdad fiscal del grupo |
| Edge Function `gestotrafic-itp` | Copia verbatim para el CRM |

> ⚠️ **`gestotrafic-itp` no está en este repo**: su fuente vive solo en Supabase.
> Antes de tocarla, expórtala (`supabase functions download gestotrafic-itp` o
> el panel), edítala y despliégala — **no la reescribas de memoria**. Es la
> única copia del motor fiscal y un dígito mal transcrito en la tabla de
> depreciación no lo detecta ningún test.

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
| `turismo` | **0** | marca / modelo / versión | **pendiente del fichero oficial** |

**Los turismos siguen pidiendo el valor base a mano.** No es un fallo: no
tenemos el Anexo I de turismos (la lista larga por marca/modelo). El esquema, el
lookup y el fallback ya están montados; falta cargar las filas. La calculadora de
producción tampoco lo tiene — también lo pide manualmente.

---

## Verificación obligatoria al tocar el motor fiscal

Cualquier cambio en `gestotrafic-itp` o en los precios se valida **comparando
contra la calculadora de producción** con el mismo vehículo:

```bash
# 1. Servir la calculadora de producción
cd WHITEMOON-WEB && python -m http.server 8877
# → abrir http://localhost:8877/calculadora-itp/ y calcular a mano

# 2. Mismo caso contra el motor del CRM
curl -s -X POST https://mlaqtniujnvfxcvcourm.supabase.co/functions/v1/gestotrafic-itp \
  -H "Content-Type: application/json" -H "apikey: $ANON" \
  -d '{"valor_boe":6700,"fecha_matriculacion":"2018-04-19",
       "fecha_transmision":"2026-07-26","ccaa":"Comunidad de Madrid",
       "cilindrada":600,"tipo_vehiculo":"moto"}'
```

**Valor venal, base imponible y cuota tienen que coincidir al céntimo.** Si no
coinciden, no se mergea: se reporta la discrepancia.

Casos de referencia verificados (Orden HAC/1501/2025):

| Caso | valor base | venal | ITP |
|---|---|---|---|
| Turismo, 2019, contrato 8.600 € | 19.800 € (manual) | 5.544,00 € | 344,00 € |
| Moto 600 cc, 2018 | 6.700 € (automático) | 1.608,00 € | 64,32 € |
| Moto eléctrica 11 kW, 2022 | 4.500 € (automático) | 2.115,00 € | 84,60 € |

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
