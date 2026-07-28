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
| Deducir piso, puerta o escalera del texto libre | **Vacíos** + marcados |
| Partir «José María de la Fuente Ruiz» en nombre y apellidos | **Vacíos** + marcados, salvo que el CRM ya lo tenga separado |
| Deducir la exención de ITP de que el vendedor sea empresa | Se lee el **toggle que marca el gestor** |

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
| `NOMBRE_*` + `APELLIDO1/2_*` (particular) | ficha de cliente del CRM, ya separada |
| `TELEFONO_*` | `<parte>_telefono` |
| `NOMBRE_VIA_*` · `NUMERO_*` · `CP_*` | domicilio del expediente, parseo conservador |
| `MUNICIPIO_*` · `PROVINCIA_*` | ficha de cliente (columnas propias), cruzada **por NIF exacto** |
| `NUMERO_BASTIDOR` | `datos.bastidor` |
| `MARCA` · `MODELO` · `FECHA_MATRICULACION` | columnas del expediente |
| `FECHA_CONTRATO` | `datos.fecha_venta` |
| `EXENTO_ITP` | toggle «Operación con factura» de la pestaña de ITP |
| `JEFATURA_PROVINCIAL` | provincia de la gestoría |

### b · Lo que asigna OEGAM/DGT al importar · **siempre vacíos**

`NUMERO_DOCUMENTO` · `CODIGO_ELECTRONICO_TRANSFERENCIA` ·
`CODIGO_ELECTRONICO_MATRICULACION` · `FECHA_PRESENTACION` · `FECHA_DEVOLUCION`

### c · Lo que completa el gestor

| Etiqueta | Por qué |
|---|---|
| `SEXO_*` de un particular | el CRM no guarda el sexo |
| `FECHA_NACIMIENTO_*` de un particular | el CRM no guarda la fecha de nacimiento |
| `*_REPRESENTANTE_*` de una empresa | sale del poder o del mandato, no del expediente |
| `SIGLAS_DIRECCION_*` | **falta el catálogo de OEGAM** (ver abajo) |
| `LETRA` · `ESCALERA` · `PISO` · `PUERTA` · `BLOQUE` · `KM` · `HM` | el domicilio es texto libre |
| `MUNICIPIO_*` · `PROVINCIA_*` sin ficha de cliente | solo salen de la ficha |
| `TARA` · `PESO_MMA` · `PLAZAS` | van a `0` como en la plantilla; el CRM no los guarda |
| `NUMERO_FACTURA` | no está en el expediente |
| Nombre/apellidos de un particular sin ficha | no se parte una cadena suelta |

El panel enseña esta lista **con el motivo de cada hueco** antes de descargar,
y avisa aparte de los **campos obligatorios** que falten.

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

## Cambios que trajo esta exportación

Dos campos que OEGAM pide y el expediente de transferencia no declaraba.
Ninguno necesita migración: viven en `datos` (jsonb).

| Campo | Etiqueta OEGAM | Nota |
|---|---|---|
| `bastidor` | `NUMERO_BASTIDOR` | Gest-IA ya lo leía de la ficha técnica, pero la transferencia no lo declaraba y **la propuesta se descartaba**. Ahora entra sola. |
| `fecha_venta` | `FECHA_CONTRATO` | Mismo campo que usa la notificación de venta, y donde Gest-IA ya deja la fecha del contrato o de la factura. |

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

Genera el XML del caso de la plantilla —empresa compra a particular— y
comprueba, entre otras cosas, que tiene **las mismas 162 etiquetas, en el
mismo orden y con el mismo anidamiento**, que los campos de OEGAM van vacíos,
que las constantes valen lo que en la plantilla, que las dos fechas van cada
una en su formato, que los bytes son Latin-1 de verdad y que nada de lo que
no se sabe se rellena. Sale con código 1 a la primera discrepancia.
