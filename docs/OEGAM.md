# Exportación a OEGAM · transferencias

El CRM genera, desde un expediente de transferencia, el XML **FORMATO_GA**
que la gestoría **importa** en el programa del Colegio de Gestores de Madrid.
Sirve para **no reteclear**: no presenta nada, no habla con la DGT y no
sustituye la revisión del gestor.

- **Dónde**: ficha del expediente → pestaña **Exportar a OEGAM**.
- **Quién lo genera**: el navegador, con los datos que ya tiene cargados.
  No hay Edge Function, no se escribe en el bucket, **no quedan huérfanos**:
  el archivo solo existe en la descarga.
- **Referencia de estructura**: [`data/oegam/plantilla-transferencia.xml`](../data/oegam/plantilla-transferencia.xml).
- **Código**: [`assets/js/oegam.js`](../assets/js/oegam.js).
- **Verificación**: `node tools/verificar-oegam.js`.

---

## ⛔ Lo que este exportador NO hace

Vale la regla de la casa: **ningún dato se inventa**. Este XML inscribe un
cambio de titularidad ante la DGT, así que un campo plausible pero falso
—que nadie va a revisar— hace más daño que un hueco vacío, que se ve.

En la práctica:

| No se hace | Qué pasa en su lugar |
|---|---|
| Rellenar lo que asigna OEGAM | Los cinco campos van **vacíos**, siempre |
| Poner un código de tipo de vía a ojo | `SIGLAS_DIRECCION_*` **vacío** + el informe dice qué tipo de vía se ha detectado |
| Elegir entre dos códigos de provincia | **Vacío** + los dos candidatos en el informe |
| Deducir piso, puerta o escalera del texto libre | **Vacíos** + marcados. El desglose sale del **DNI**, leído por Gest-IA |
| Partir «José María de la Fuente Ruiz» en nombre y apellidos | **Vacíos** + marcados. El DNI los imprime separados y así se leen |
| Traducir a ojo la letra de sexo del DNI | A Gest-IA se le pide la **palabra** («hombre»/«mujer»); la traducción a V/H vive en un sitio |
| Ocultar o corregir un DNI caducado | La fecha va tal cual + **aviso** para que lo vea el gestor |
| Rellenar el contrato con datos que no hay | Salen como **líneas de guiones**; el gestor las ve al revisar |
| Deducir la exención de ITP de que el vendedor sea empresa | Se lee el **toggle que marca el gestor** |

### Sexo · V · H · X

Códigos del formato, confirmados por la gestoría:

| Código | Significado |
|---|---|
| `V` | Hombre |
| **`H`** | **Mujer** — es H, **no** M |
| `X` | Persona jurídica |

La de mujer es la trampa: `M` es justo lo que uno pondría por instinto, y es
además lo que trae el propio DNI español, donde `M` significa *masculino*. Por
eso a Gest-IA se le pide la **palabra** (`hombre` / `mujer`) y no la letra del
documento; la traducción es una tabla de dos entradas en `gestia.js`, y el
exportador descarta cualquier cosa que no sea V, H o X.

Una empresa es `X` **por serlo**: lo decide el `<parte>_tipo` del expediente,
no la lectura de ningún documento.

---

## El mapa · qué alimenta cada etiqueta

### a · Lo que tenemos

| Etiqueta OEGAM | De dónde sale |
|---|---|
| `NIF` · `NOMBRE` · `PROFESIONAL` · `PROVINCIA` | `GT_CONFIG.GESTORIA` (config.js) |
| `DATOS_PRESENTADOR/*` | `GT_CONFIG.GESTORIA` · la gestoría es el presentador |
| `REFERENCIA_PROPIA` | `expediente.referencia` (EXP-AAAA-NNNN) |
| `FECHA_CREACION` | fecha de generación |
| `MATRICULA` | `expediente.matricula` |
| `DNI_ADQUIRIENTE` / `DNI_TRANSMITENTE` | `comprador_nif` / `vendedor_nif` |
| `APELLIDO1_RAZON_SOCIAL_*` (empresa) | `comprador_nombre` / `vendedor_nombre` |
| `SEXO_*` (empresa) | `X` · lo dice el `<parte>_tipo` del expediente |
| `SEXO_*` (particular) | **DNI** · `hombre`→V, `mujer`→H |
| `NOMBRE_*` + `APELLIDO1/2_*` (particular) | **DNI**, que los imprime separados; si no, ficha de cliente |
| `FECHA_NACIMIENTO_*` | **DNI** (anverso) |
| `FECHA_CADUCIDAD_NIF_*` | **DNI** (anverso) · con aviso si ya pasó |
| `TELEFONO_*` | `<parte>_telefono` |
| `NOMBRE_VIA_*` · `NUMERO_*` · `LETRA` · `ESCALERA` · `PISO` · `PUERTA` | **DNI** (reverso), desglosado por Gest-IA |
| `MUNICIPIO_*` · `PROVINCIA_*` · `CP_*` | **DNI** (reverso); si no, ficha de cliente cruzada **por NIF exacto** |
| `NUMERO_BASTIDOR` | `datos.bastidor` (ficha técnica) |
| `MARCA` · `MODELO` · `FECHA_MATRICULACION` | columnas del expediente |
| `FECHA_CONTRATO` | `datos.fecha_venta` · la fija el **contrato auto-generado** |
| `EXENTO_ITP` | toggle «Operación con factura» de la pestaña de ITP |
| `JEFATURA_PROVINCIAL` | provincia de la gestoría |

**Orden de preferencia** para los datos de una persona: (1) lo que Gest-IA leyó
de su **DNI**, o lo que el gestor corrigió encima; (2) su **ficha de cliente**
del CRM, cruzada por NIF exacto; (3) el domicilio en **texto libre**, del que
solo se saca vía, número y CP. Lo que no salga de ninguna, vacío y marcado.

### b · Lo que asigna OEGAM/DGT al importar · **siempre vacíos**

`NUMERO_DOCUMENTO` · `CODIGO_ELECTRONICO_TRANSFERENCIA` ·
`CODIGO_ELECTRONICO_MATRICULACION` · `FECHA_PRESENTACION` · `FECHA_DEVOLUCION`

### c · Lo que completa el gestor

Con los dos DNIs leídos a dos caras, **esta lista se queda casi vacía**:

| Etiqueta | Por qué |
|---|---|
| `SIGLAS_DIRECCION_*` | **falta el catálogo de OEGAM** (ver abajo) — el único hueco estructural |
| `*_REPRESENTANTE_*` de una empresa | sale del poder o del mandato, no del expediente |
| `TARA` · `PESO_MMA` · `PLAZAS` | van a `0` como en la plantilla; el CRM no los guarda |
| `NUMERO_FACTURA` | no está en el expediente |
| Cualquier dato del DNI que no se leyera | vacío + el motivo, en el informe |

El panel enseña esta lista **con el motivo de cada hueco** antes de descargar,
avisa aparte de los **campos obligatorios** que falten, y trae un formulario
—«Datos de las personas»— para corregir o completar lo que Gest-IA propuso.

Ese formulario vive en la pestaña de exportación y no en la ficha a propósito:
son treinta campos entre las dos partes, casi siempre ya rellenos, que solo
importan al exportar. En el formulario del trámite serían tres pantallas de
scroll que nadie mira.

---

## ⚠️ Dos catálogos que faltan · pendientes de la gestoría

Sin ellos el exportador funciona, pero deja campos vacíos que el gestor
rellena a mano. Con ellos, se rellenan solos.

### 1 · Tipos de vía (`SIGLAS_DIRECCION_*`)

**Es el bloqueante real.** OEGAM identifica el tipo de vía con un **código
numérico de su catálogo**. La plantilla pone `41` en las tres direcciones,
incluida una que se llama «VIA EJEMPLO» — ahí `41` es relleno, no la prueba
de que `41` sea CALLE. Deducir la tabla de eso sería inventarla.

**Qué pedir**: la tabla de tipos de vía de OEGAM (etiqueta → código).

**Dónde ponerla**: `SIGLAS` en [`assets/js/oegam.js`](../assets/js/oegam.js).
Es un solo objeto:

```js
const SIGLAS = { CALLE: '41', AVENIDA: '02', PLAZA: '58', … };
```

Mientras esté vacío, el tag sale vacío y el informe dice qué tipo de vía se
ha detectado en cada dirección, para que el gestor busque el código sin
releer el domicilio.

### 2 · Tres provincias con dos códigos

La tabla `PROVINCIAS` lleva los 52 códigos provinciales de la DGT — la
plantilla confirma tres (`M`, `B`, `MA`). Tres provincias cambiaron de código
y conviven con el antiguo:

| Provincia | Candidatos |
|---|---|
| Baleares | `PM` o `IB` |
| Girona | `GI` o `GE` |
| Ourense | `OU` o `OR` |

Salen **vacías** con los dos candidatos en el informe. Cuando la gestoría
confirme cuál usa su programa, se cambia `{ ambiguo: [...] }` por el código.

### 3 · Constantes a confirmar (no bloquean)

Copiadas **verbatim** de la plantilla porque son los valores de una
transferencia estándar, pero su significado está sin verificar:

`TIPO_DGT` = `TRANSMISION ELECTRONICA` · `CAMBIO_SERVICIO` = `NO` ·
`MODO_ADJUDICACION` = `1` · `TIPO_TRANSFERENCIA` = `1` ·
`DECLARACION_RESPONSABILIDAD` = `NO` · `TIPO_ID_VEHICULO` = `40` ·
`NUMERO_TITULARES` = `1` · `TARA`/`PESO_MMA`/`PLAZAS` = `0`

Viven juntas en `CONSTANTES` (oegam.js). Confirmarlas una vez con la gestoría
las deja cerradas para siempre.

---

## Formato

| Detalle | Valor |
|---|---|
| Codificación | **ISO-8859-1**, declarada y escrita byte a byte |
| Fechas del cuerpo | `DD/MM/AAAA` |
| Atributo `FechaCreacion` | `MM/DD/AAAA` — **al revés**, y así lo pide la plantilla |
| Tags sin valor | self-closing (`<OBSERVACIONES/>`) |
| Texto | mayúsculas, como la plantilla; los acentos se conservan |

Un Blob de una cadena JS sale en UTF-8, así que la codificación se hace a
mano. Las comillas y guiones tipográficos que mete un copiar-pegar se
normalizan antes; lo que aun así no quepa en Latin-1 se sustituye **y se
denuncia en el informe**, porque un carácter perdido en silencio dentro de un
nombre es un nombre mal inscrito.

---

## ⚠️ La gestoría de la demo es FICTICIA

`GT_CONFIG.GESTORIA` trae datos **inventados** para que la demo enseñe el
formato entero en vez de media exportación en blanco:

| Campo | Valor de demo |
|---|---|
| Nombre | WhiteMoon Tráfico |
| CIF | `B00000000` — **placeholder** |
| Nº profesional | `0000` — **placeholder** |
| Teléfono | `900000000` — **placeholder** |
| Domicilio | Calle Madrid 9, 2ºB · Majadahonda · Madrid · CP 28220 · provincia `M` |

Van marcados con **`demo: true`**. Con esa bandera puesta, la pestaña de
exportación avisa de que el XML lleva un CIF y un colegiado inventados y **no
debe presentarse**.

**Al instalar en una gestoría real**: sustituye los cuatro placeholders por los
suyos y **quita `demo: true`**.

---

## El contrato se genera y se guarda solo

Al pasar un expediente a **tramitación**, si no hay contrato:

1. se genera el contrato de compraventa con los datos del expediente,
2. se guarda en su checklist como documento `contrato`,
3. y su **fecha** queda en `datos.fecha_venta` → `FECHA_CONTRATO` del XML.

La fecha es la de la operación si el expediente ya la conocía y, si no, la de
hoy: es la fecha que lleva el documento que se acaba de crear, no una fecha
supuesta. Se guarda con él para que no se recalcule en cada visita.

Solo aplica cuando **vende un particular**. Si vende una empresa, el negocio se
documenta con **su factura** y el checklist pide esa.

Es el mismo generador de siempre (`GTContrato`), así que el contrato que se
guarda y el que se descarga son literalmente el mismo documento. Y no rellena
huecos: un dato que el expediente no tiene sale como una línea de guiones. Es
un **borrador**: lo revisan y lo firman las partes.

También hay botón manual en la pestaña **Contrato**.

---

## Cambios que trajo esta exportación

Campos que OEGAM pide y el expediente de transferencia no declaraba. Ninguno
necesita migración: **todos viven en `datos` (jsonb)**.

| Campo | Etiqueta OEGAM | Nota |
|---|---|---|
| `bastidor` | `NUMERO_BASTIDOR` | Gest-IA ya lo leía de la ficha técnica, pero la transferencia no lo declaraba y **la propuesta se descartaba**. Ahora entra sola. |
| `fecha_venta` | `FECHA_CONTRATO` | Mismo campo que usa la notificación de venta. Lo fija el contrato auto-generado. |
| `<parte>_nombre_pila` · `_apellido1` · `_apellido2` | `NOMBRE_*` · `APELLIDO1/2_*` | Del DNI, que los imprime separados |
| `<parte>_sexo` | `SEXO_*` | V / H / X |
| `<parte>_nacimiento` · `_caducidad_nif` | `FECHA_NACIMIENTO_*` · `FECHA_CADUCIDAD_NIF_*` | Anverso del DNI |
| `<parte>_via` · `_via_numero` · `_escalera` · `_piso` · `_puerta` · `_letra` | desglose de la dirección | Reverso del DNI |
| `<parte>_municipio` · `_provincia` · `_cp` | `MUNICIPIO_*` · `PROVINCIA_*` · `CP_*` | Reverso del DNI |

### El presupuesto de uniones del esquema de Gest-IA

La API de Claude admite **como mucho 16 parámetros con `anyOf`** por esquema, y
cada campo *nullable* gasta uno. El perfil `dni` pasó de 5 campos a 17, así que
los **seis del desglose de la vía** se declaran con `simple: true`: son cadenas
y su hueco es `""`.

No es una excepción a la regla anti-invención, es lo que permite cumplirla. Lo
que de verdad decide —nombre, apellidos, número, sexo, fechas, municipio,
provincia, CP— sigue siendo nullable, que es donde `null` significa «no me lo
inventes». Total: **11 uniones de 16**.

Pasarse del tope no da un aviso: devuelve `400` y **toda** lectura de DNI deja
de funcionar en caliente. Por eso `verificar-oegam.js` lo cuenta desde fuera.

---

## Otros colegios

Hoy solo hay OEGAM (Madrid) y solo para transferencias. El aislamiento está
puesto para que añadir otro sea añadir un módulo:

- el trámite declara su formato con `exporta: 'oegam'` (tramites.js),
- `GT_CONFIG.EXPORTACION` nombra el que está activo,
- toda la lógica del formato vive en `assets/js/oegam.js` y nadie más la conoce.

## Verificación

```bash
node tools/verificar-oegam.js
```

142 comprobaciones. Genera el XML del caso de la plantilla —empresa compra a
particular— y comprueba, entre otras cosas, que tiene **las mismas 162
etiquetas, en el mismo orden y con el mismo anidamiento**, que los campos de
OEGAM van vacíos, que las constantes valen lo que en la plantilla, que las dos
fechas van cada una en su formato, que los bytes son Latin-1 de verdad y que
nada de lo que no se sabe se rellena.

Y una prueba **de punta a punta**: simula la respuesta de la Edge Function para
los DNIs de comprador y vendedor leídos a dos caras, y la hace pasar por la
cadena real —`GTGestIA.propuestas` → `aExpediente` → `GTOegam.construir`—. Ni
un campo se escribe a mano en el expediente, así que si el mapeo se rompe por
el camino, esto se cae. Comprueba que el XML sale completo y que **lo único que
queda pendiente son los `SIGLAS_DIRECCION`**.

Sale con código 1 a la primera discrepancia.

> `gestia-extraer` hay que **desplegarlo** para que la lectura ampliada del DNI
> funcione: `supabase functions deploy gestia-extraer`. Mientras no se
> despliegue, Gest-IA sigue leyendo los cinco campos de antes y el resto queda
> vacío y marcado — que es el comportamiento correcto, no un fallo.
