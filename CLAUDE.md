# CLAUDE.md — GestoTrafic

CRM de demostración para gestorías de tráfico. HTML/CSS/JS puro sobre GitHub
Pages, con Supabase detrás (proyecto `mlaqtniujnvfxcvcourm`).

Documentación funcional en [`docs/`](docs/): [FASE-1](docs/FASE-1.md) ·
[TRAMITES](docs/TRAMITES.md) · [USUARIOS](docs/USUARIOS.md) ·
[GEST-IA](docs/GEST-IA.md) · [OEGAM](docs/OEGAM.md).

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
| `autocaravana` | **9.252** | marca / modelo / versión | XML del BOE · [`data/boe/`](data/boe/) |

Ninguno pide ya el valor base a mano: se elige la versión en el buscador del
panel ITP y el valor sale del Anexo I. **El campo manual sigue existiendo** como
respaldo para lo que no esté en la tabla.

> ⚠️ **Turismo y autocaravana NO son intercambiables.** El Anexo IV les aplica
> **tablas de depreciación distintas**: la general (13 tramos) y la de
> autocaravanas, campers y vehículos vivienda (19 tramos, hasta «más de 18
> años»). La segunda baja mucho más despacio — a los 5 años conserva el 59 %
> frente al 39 %—, así que **depreciar una autocaravana con la tabla de
> turismos liquida de menos**: en el BENIMAR Sport Up 340 de 2019 la diferencia
> es 1.443,84 € frente a 842,24 €.
>
> Por eso van con `tipo_vehiculo` distinto, cada buscador ve solo sus filas, y
> la búsqueda filtra por tipo: pedir un id de autocaravana como turismo devuelve
> `sin_match` en lugar de calcular con la tabla equivocada.

### Por qué la versión la elige una persona

Vale igual para turismos y autocaravanas.

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

Cubre 20 casos: los tres de referencia, el valor base automático de turismos,
autocaravanas y motos, **las dos tablas del Anexo IV** (comprobando además que
el motor declara cuál ha usado), las ramas fiscales (exención, cuota fija
estándar y valenciana, ECO, >15 CVf, uso especial) y los dos en que el motor
**debe negarse a calcular** (varias versiones posibles y sin match).

Casos de referencia verificados (Orden HAC/1501/2025):

| Caso | valor base | venal | ITP |
|---|---|---|---|
| Turismo, 2019, contrato 8.600 € | 19.800 € (manual) | 5.544,00 € | 344,00 € |
| Moto 600 cc, 2018 | 6.700 € (automático) | 1.608,00 € | 64,32 € |
| Moto eléctrica 11 kW, 2022 | 4.500 € (automático) | 2.115,00 € | 84,60 € |
| SEAT Ibiza 1.0 TSI Style (2021), Madrid | 13.600 € (Anexo I) | 5.304,00 € | 212,16 € |
| Tesla Model 3 Gran Autonomía RWD, Cataluña, etiqueta 0 | 48.300 € (Anexo I) | 18.837,00 € | 0,00 € |
| BENIMAR Sport Up 340 (2019), Madrid · **autocaravana** | 75.200 € (Anexo I) | 36.096,00 € | 1.443,84 € |

Si además tocas las **tablas** de `gestotrafic-itp`, compáralas valor a valor
con las de producción antes de desplegar: un dígito mal transcrito en la
depreciación no lo detecta ningún caso suelto.

---

## Cambio de servicio · registrar siempre, bloquear por CÓDIGO

Un vehículo que ha estado de VTC o de alquiler sin conductor **no se
transfiere a particular sin más**: su ficha técnica lleva otro código de
clasificación y hay que pasar por la ITV a cambiarlo ANTES. Presentarla con el
código viejo es que te la devuelvan.

Dos cosas que **no** son la misma:

1. **Registrar** el cambio · siempre que se marque. Va al XML (`CAMBIO_SERVICIO`).
2. **Bloquear** la tramitación · solo si el CÓDIGO tiene que cambiar y la ficha
   técnica todavía no lo refleja.

| Servicio | Código de clasificación |
|---|---|
| Particular | **1000** |
| Taxi | **1000** ← el mismo que particular |
| VTC | **1041** |
| ASN (alquiler sin conductor) | **1003** |

**La regla es por CÓDIGO, no por etiqueta.** Taxi → Particular cambia de
servicio pero NO de código: se registra y se transfiere directamente. Mandar a
la ITV a quien no tiene que ir es un error tan real como dejar pasar al que sí.

⛔ **Solo esos tres códigos.** Cualquier otro servicio va con `codigo: null`, y
eso **no significa «no bloquea»**: significa que no se puede decidir, así que
bloquea y pide el código. La regla entera vive en
[`assets/js/servicio.js`](assets/js/servicio.js).

```bash
node tools/verificar-servicio.js
```

> El código de la ficha lo lee Gest-IA (`clasificacion_codigo` del perfil
> `ficha_tecnica`) o lo escribe el gestor mirándola. Es **otra cosa** que la
> palabra de la clasificación, que es la que decide la tabla del Anexo I: no se
> tocan entre sí. Y los campos `SERVICIO_*` de OEGAM son **otro catálogo**, que
> no tenemos: salen vacíos y marcados, como `SIGLAS_DIRECCION`.

---

## Honorarios · el IVA solo toca los honorarios

Lo que se liquida a Hacienda y lo que se le **cobra al cliente** son cuentas
distintas. La factura suma tres conceptos que tributan distinto:

| Concepto | IVA | Por qué |
|---|---|---|
| ITP | **NO** | es un impuesto; no se grava con otro |
| Tasa DGT | **NO** | es un **suplido** · art. 78.Tres.3.º LIVA |
| Honorarios | **SÍ** (21%) | es el servicio de la gestoría |

**Meter la tasa DGT o el ITP en la base del IVA le cobra al cliente un dinero
que no debe**, y es de los errores que no se ven: el total sale más alto y
parece igual de correcto. Por eso la multiplicación por el tipo está en **un
solo sitio** —`calcular()` en [`assets/js/honorarios.js`](assets/js/honorarios.js)—
y no hay ninguna otra en el módulo.

```bash
node tools/verificar-honorarios.js
```

> `honorarios_total_cliente` es una cuenta de cuatro cifras que ya viven en el
> expediente, así que **puede quedarse atrás**. Todo lo que mueva alguna de las
> cuatro —guardar honorarios, calcular el ITP, marcar la exención— tiene que
> pasar por `GTHonorarios.conTotal()`; la pantalla pinta siempre desde
> `calcular()`, nunca desde el valor guardado.

---

## Exportación a OEGAM · dos catálogos pendientes

La ficha de transferencia genera el XML **FORMATO_GA** que la gestoría
importa en el programa del Colegio de Madrid
([`assets/js/oegam.js`](assets/js/oegam.js), doc en [`docs/OEGAM.md`](docs/OEGAM.md)).
Se verifica contra la plantilla de referencia:

```bash
node tools/verificar-oegam.js
```

Con los DNIs de comprador y vendedor leídos a dos caras, el XML sale completo.
**Le faltan dos tablas oficiales que solo puede dar la gestoría**. Mientras no
lleguen, esos campos salen VACÍOS y marcados en el informe del panel — que es
lo correcto, no un fallo:

1. **Tipos de vía** → los códigos de `SIGLAS_DIRECCION_*`. La plantilla pone
   `41` hasta en una vía llamada «VIA EJEMPLO», así que ahí `41` es relleno.
   **No se deduce la tabla de eso.** Se carga en la constante `SIGLAS`.
2. **Baleares, Girona y Ourense**, con dos códigos provinciales históricos
   cada una (`PM`/`IB`, `GI`/`GE`, `OU`/`OR`). Los otros 49 sí están.

> ⚠️ **La gestoría de `GT_CONFIG.GESTORIA` es la de la DEMO**: CIF, número de
> profesional y teléfono son inventados y van marcados con `demo: true`, que
> hace saltar un aviso en la pestaña de exportación. Al instalar en una
> gestoría real, sustitúyelos y quita la bandera.

> **Sexo: V hombre · H mujer · X persona jurídica.** La de mujer es **H, no M**
> —y el DNI español imprime `M` de *masculino*, que es justo la confusión—. Por
> eso a Gest-IA se le pide la palabra («hombre»/«mujer») y la traducción vive
> solo en `gestia.js`.

> Tocar el perfil `dni` de `gestia-extraer` obliga a mirar **dos topes**, no uno:
> las 16 uniones `anyOf` por esquema **y el tamaño de la gramática compilada**,
> que se agota mucho antes — 14 campos compilan, 15 devuelven 400. Vigilar solo
> el primero es lo que dejó el DNI roto en producción con 17 campos y 11 uniones,
> devolviendo `200` porque el fallo se captura por documento. Por eso el DNI se
> lee **en dos bloques, uno por cara**, y `MAX_CAMPOS_ESQUEMA` hace fallar el
> arranque de la función si alguien los junta. El verificador cuenta campos por
> bloque. Y hay que **desplegar** la función para que el cambio surta efecto.

Y hay un tercer punto, que no bloquea: las **constantes copiadas verbatim**
de la plantilla (`TIPO_ID_VEHICULO` = 40, `MODO_ADJUDICACION` = 1,
`TARA`/`PESO_MMA`/`PLAZAS` = 0…). Están todas juntas en `CONSTANTES` para
confirmarlas de una vez.

> `EXENTO_ITP` sale del toggle «Operación con factura» que marca el gestor en
> la pestaña de ITP. **No** de que el vendedor sea una empresa: eso la
> pestaña se limita a avisarlo, y confirmarlo es cosa de una persona.

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
