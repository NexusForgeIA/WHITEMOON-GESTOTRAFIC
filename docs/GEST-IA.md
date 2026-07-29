# Gest-IA · alta de expedientes por documentos

El gestor sube los documentos de un trámite y Gest-IA los lee, extrae los datos,
monta el expediente pre-rellenado y calcula el ITP. El expediente nace en
**pendiente de validación**: no entra en el flujo normal hasta que una persona
lo revisa y confirma.

---

## La regla que manda sobre todas las demás

> Si un dato no aparece o no se lee con claridad, se devuelve **null** con
> confianza **baja**. Nunca se inventa.

Esto no es una preferencia de estilo. Los datos que salen de aquí liquidan
impuestos e inscriben cambios de titularidad ante la DGT. **Un dato inventado
que parece correcto hace más daño que un hueco vacío**, porque el hueco se ve y
el dato plausible no: nadie lo revisa.

Por eso el prompt lo dice explícitamente, la interfaz **resalta en rojo** lo que
quedó sin leer, y el expediente no avanza sin OK humano.

Comprobado en la demo: de un DNI escaneado solo por el anverso, el domicilio
vuelve `null` aunque el modelo podría haberlo deducido; de un permiso de
circulación con la matrícula tapada por un sello, la matrícula vuelve `null`
**aunque esa misma matrícula estaba en la ficha técnica del mismo lote**. Cada
documento se lee por separado, sin contaminación cruzada.

---

## El flujo

```
1 · Tipo de trámite        el gestor elige uno de los 7 del catálogo
2 · Subida                 los documentos que pide SU checklist
3 · Extracción             gestia-extraer → Claude visión, un documento por lectura
4 · Montaje                propuestas → campos del expediente + ITP
5 · Validación humana      el gestor revisa, corrige y pulsa "Validar y crear"
```

### 1 · Por qué el expediente se crea antes de subir

La política del bucket comprueba la propiedad del expediente a partir de la ruta
(`<expediente_id>/<archivo>`). Sin expediente no hay ruta válida, así que el
orden es: crear el expediente vacío en `pendiente_validacion` → subir → leer.

Si la extracción falla a mitad, el expediente queda con los documentos que sí
subieron y el gestor lo completa a mano. Se avisa en pantalla con su referencia.

### 2 · Qué se lee de cada documento

| Documento | Campos |
|---|---|
| DNI / NIE | nombre, apellidos, número, domicilio, **provincia** |
| CIF / empresa | razón social, CIF, domicilio social, **provincia** |
| Ficha técnica | marca, modelo, bastidor, matrícula, 1ª matriculación, combustible, CVf, cilindrada, **clasificación** |
| Permiso de circulación | titular, matrícula |
| Contrato / factura | precio, fecha, vendedor, comprador |

#### Un documento, varios archivos

Un DNI tiene **dos caras** y los datos están repartidos: el número y el nombre
en el anverso, el **domicilio en el reverso**. Con una sola cara se pierde la
otra mitad, así que el hueco admite las dos —o un único archivo con todo, para
quien lo tenga escaneado junto.

Son varias filas de `gestotrafic_documentos` con el **mismo `tipo`**. No hizo
falta columna nueva: la cara viaja en el nombre del objeto del bucket
(`<expediente>/dni_comprador.reverso-<ts>.jpg`), que es un dato del archivo. Un
objeto sin marca de cara —los de antes de esto— se lee como el documento
entero, que es lo que era.

`gestia-extraer` **agrupa por `tipo` y devuelve un solo resultado por
documento**, para que el domicilio del reverso caiga en el mismo registro que el
número del anverso. Agrupa por tipo y solo por tipo: cada documento del
checklist sigue siendo su propia lectura, así que **el DNI del comprador nunca
ve el del vendedor** y no hay manera de que un dato de uno acabe en el otro.

El permiso de circulación y la ficha técnica admiten lo mismo (dos caras, dos
páginas). Solo el DNI declara sus caras en el perfil de extracción, porque es
el único donde un campo concreto vive en una cara concreta.

#### Por dentro, el DNI son dos llamadas

El perfil `dni` no monta un esquema con sus 17 campos: monta **uno por cara**
—7 del anverso y 10 del reverso— y funde las dos respuestas antes de devolver
nada. Es obligado, no una preferencia: el esquema se compila a una gramática con
un tamaño máximo y **14 campos compilan, 15 ya no** (ver *Los dos topes* abajo).

Que la partición siga a las caras del documento, y no a un corte arbitrario por
la mitad, sale gratis y aporta: la llamada del anverso **no ve el reverso**, así
que no puede confundir la provincia de nacimiento con la del domicilio — que es
la confusión clásica de esta lectura, y la que decide con qué tipo autonómico se
liquida el ITP.

El cliente manda además la `cara` de cada archivo, así que cada llamada recibe
solo la suya y el coste en imágenes no sube. Si no la manda —un cliente antiguo,
o un único archivo con las dos caras— cada bloque ve todos los archivos y la
lectura sale igual.

#### La cara que falta se dice, no se rellena

Cada bloque responde en `cara_vista` si está viendo su cara **de verdad**. De ahí
se reconstruye `caras_vistas`, de ahí sale `caras_faltan`, y de ahí el aviso del
banner: *«DNI / NIE del comprador · falta el reverso»*.

Se pregunta explícitamente en vez de deducirlo de que el domicilio venga vacío
porque **no son lo mismo**: un domicilio borroso se arregla con una foto mejor y
una cara que no se ha subido se arregla subiéndola. El campo, mientras tanto,
queda en `null` con confianza baja y su nota — la regla de siempre.

Cada campo vuelve con `valor`, `confianza` (alta/media/baja) y `nota`. Los tipos
que no se leen automáticamente (certificados del CAT, denuncias, «otros») se
suben igual y quedan en el checklist.

Si dos documentos aportan el mismo campo, gana el de **más confianza**; a
igualdad, el primero. **Un `null` nunca pisa un valor leído.**

#### Quién es empresa se pregunta, no se adivina

El checklist de la transferencia es condicional: un particular aporta **DNI/NIE**
y contrato, una empresa aporta **CIF** y **factura**. Ese `si` se resuelve
leyendo el expediente… que en esta pantalla **todavía no existe**. Por eso la
subida pregunta primero *quién vende* y *quién compra*, y solo entonces pinta la
lista. Sin esa pregunta pediría siempre el DNI del vendedor, incluso vendiendo un
concesionario, y el CIF no habría manera de subirlo.

La respuesta nace con el expediente (`datos.vendedor_tipo`,
`datos.comprador_tipo`), así que la ficha y su checklist coinciden desde el
primer momento. Después, el propio checklist confirma lo mismo por su cuenta: un
`cif_vendedor` o una `factura_venta` marcan al vendedor como empresa; un
`cif_comprador`, al comprador. Va con confianza **alta** y origen `checklist`
—no es una lectura del modelo, es qué documento se ha aportado— y como todo lo
demás **sigue siendo propuesta**: la valida el gestor.

Con el vendedor en empresa, la pestaña de ITP avisa de que una venta con factura
sujeta a IVA suele quedar **exenta**. El aviso es solo eso: la exención la marca
el gestor con su toggle, nunca Gest-IA.

### 3 · El ITP · propuesto entero

Con los documentos subidos y legibles, Gest-IA **propone el ITP completo y lo
calcula sola**. Los tres datos que antes ponía el gestor a mano salen ahora de
los papeles:

| Dato | De dónde sale | Si no se lee |
|---|---|---|
| **Tipo de vehículo** | campo *clasificación* de la ficha técnica | en blanco; lo elige el gestor |
| **CCAA** | provincia del domicilio del **comprador**, en el reverso de su DNI | en blanco; la elige el gestor |
| **Valor base** | tabla del Anexo I, filtrada con lo leído de la ficha | en blanco; se pone a mano |

El expediente queda en **pendiente de validación** con el ITP calculado y cada
campo marcado como propuesta, con su confianza y su origen. El gestor revisa y
valida; no teclea.

**Por qué la CCAA sale del comprador y no del vendedor**: el ITP lo liquida
quien compra, en su comunidad. Con vendedor en Barcelona y comprador en Madrid,
la CCAA es Madrid.

**Traducir provincia a comunidad es geografía, no fiscalidad** — o la provincia
está en la tabla `GT_PROVINCIAS` o no está. Lo que no se hace es deducir la
provincia de la calle, del municipio o del código postal: eso sería justo el
tipo de dato plausible que esta casa no genera. Y en el reverso del DNI conviven
la provincia de nacimiento y la del domicilio, así que al modelo se le pide
explícitamente la **del domicilio** y que devuelva `null` si no las distingue.

Con la clasificación pasa igual: `TURISMO`, `MOTOCICLETA` o `AUTOCARAVANA` se
traducen; un `VEHÍCULO MIXTO ADAPTABLE` **no se acerca al tipo más parecido**,
porque turismo y autocaravana se deprecian con tablas distintas y acercarse
cambia el impuesto.

#### Lo que no calcula, lo dice

Si falta alguna de las tres piezas, **no se calcula nada**: el banner del
expediente dice exactamente cuál falta y dónde completarla. Nunca un cálculo a
medias ni un valor por defecto silencioso — antes se asumía «turismo» y
«Comunidad de Madrid» sin decirlo, y eso es un dato fiscal inventado con buena
presencia.

Lo que sí se conserva es lo que se pudo averiguar: si el valor base se encontró
pero falta la CCAA, el valor base **se queda puesto** y el gestor solo completa
lo que falta.

#### Varias versiones: aquí no elige

Si encajan **varias versiones del modelo con precios distintos**, Gest-IA no
elige ninguna y lleva al gestor a fijarla, con todo lo demás ya propuesto. Es la
regla de la casa: entre dos versiones del mismo modelo puede haber mil euros, y
acertar por sorteo no es acertar.

### 4 · El motor del ITP

El cálculo lo hace el motor real `gestotrafic-itp`, el mismo que usa el panel
del expediente: Gest-IA propone los datos de entrada, no reimplementa el
impuesto.

El **valor BOE** no está en ningún documento —sale de la tabla de precios medios
del Anexo I—, y el **tipo de vehículo** decide en qué tabla se busca y con cuál
del Anexo IV se deprecia. El precio de contrato y la fecha de matriculación sí
salen de los papeles.

#### Cómo se propone el valor base

Terminada la lectura, `gestotrafic-valor-base` busca en
`gestotrafic_precios_medios` con lo que Gest-IA leyó. Vive en el servidor
porque las funciones de búsqueda solo tienen `execute` para `authenticated` y
`service_role`, y las ~71.000 filas no tienen por qué bajar al navegador.

En **motos, quads y buggys** el Anexo I tarifa por tramo: sale una fila o
ninguna, no hay nada que elegir.

En **turismos y autocaravanas** se parte de todas las versiones del modelo
vigentes en el año de matriculación y se estrecha con lo leído de la ficha:
cilindrada, combustible y las palabras del modelo. Dos detalles que importan:

- Se compara **por palabras sueltas, no por subcadena**: el BOE escribe
  «GOLF VII 1.5 TSI EVO Advance 5p» y una ficha que ponga «Golf 1.5 TSI» no
  aparece como subcadena por culpa del «VII».
- **Un filtro que deje la lista vacía se descarta.** Si la cilindrada viene mal
  leída, es preferible ofrecer de más que esconder la versión correcta.

Con un Golf de 2018 eso baja de 614 versiones del modelo a 26, y a 2 si la
ficha trae la denominación completa.

Y entonces, siempre:

| Resultado | Qué pasa |
|---|---|
| 1 versión | se **propone** preseleccionada; el gestor la confirma |
| varias | se ofrecen **sin seleccionar ninguna**; elige el gestor |
| ninguna | el campo se queda **manual**, sin inventar nada |

El expediente ya está creado y en `pendiente_validacion` antes de este paso, así
que el gestor puede saltárselo y rellenar el valor base luego en la calculadora
del expediente. **Nada se calcula sin que una persona haya fijado la fila.**

#### Por qué Gest-IA no elige la versión

En motos, quads y buggys el Anexo I tarifa por tramo de cilindrada o de kW, así
que el valor base sale solo del dato de la ficha técnica.

En turismos y autocaravanas no: el Anexo I lista **61.634 + 9.252 versiones** y
la ficha técnica no trae la denominación comercial exacta del BOE. Gest-IA lee
«Modelo» (campo D.3) y con eso se preselecciona **marca y modelo** —que solo
sirven para navegar— y se **propone** la versión más parecida, marcada con
`★ propuesta IA`. La versión queda **sin elegir**: la confirma el gestor.

No es una precaución de más. En el Anexo I hay **5.107 denominaciones que se
repiten dentro de su marca con precios distintos**: `CLIO 1.5 DCI Authentique
3p`, por ejemplo, existe con 48, 63 y 66 kW y vale 10.500, 11.400 u 11.600 €.
Lo que las distingue son los kW de la ficha técnica, no el nombre. Elegir a
ciegas entre esos tres precios sería inventar el valor base.

Si ninguna versión se parece lo suficiente, o si las dos mejores empatan, no se
propone ninguna: se avisa en ámbar y se pide selección manual.

### 5 · La validación es obligatoria

Mientras `ia_estado = 'pendiente_validacion'`:

- un aviso encabeza el expediente contando cuántos campos son de confianza alta,
  cuántos hay que revisar y cuántos obligatorios quedaron sin leer
- **cada campo lleva un sello** (`IA ALTA` / `IA MEDIA` / `IA BAJA` / `NO LEÍDO`)
  con el documento de origen y la nota en el *tooltip*
- los de confianza media se marcan en ámbar y los no leídos en rojo
- el listado y el Kanban muestran una etiqueta **IA** en la referencia

Al pulsar **Validar y crear** se guarda quién validó y cuándo, el expediente pasa
a `validado` y los sellos desaparecen: ya es un expediente normal.

---

## Seguridad y RGPD

- **La API key nunca sale del servidor.** La extracción vive en la Edge Function
  `gestia-extraer`; el navegador solo manda su token de sesión.
- **Los documentos siguen en el bucket privado.** La función los descarga con el
  `service_role`; no se generan URLs firmadas para el modelo.
- **Doble comprobación de permisos.** `verify_jwt: true` solo garantiza que el
  token es del proyecto — la clave anon también lo es. La función identifica
  además al usuario y comprueba que el expediente **es suyo** (o que es admin),
  con el mismo criterio que el RLS.
- **Datos personales.** Los documentos son DNI, permisos y contratos. En la
  función solo se leen en memoria para la llamada al modelo; no se persisten ni
  se escriben en logs. Lo que se conserva es `ia_extraccion` dentro del
  expediente, bajo su mismo RLS: solo su gestor y el admin lo ven.
- **Se conserva a propósito.** `ia_extraccion` es la traza de qué propuso la IA y
  con qué confianza. Es lo que hace auditable la validación: sin ella no se
  podría saber si un dato lo puso el modelo o la persona.

---

## El modelo

`claude-opus-5`, con **structured outputs** (esquema JSON por tipo de documento,
así la respuesta siempre encaja) y `effort: medium` — la lectura de un documento
no es una tarea de razonamiento profundo, y el gestor está esperando delante de
la pantalla.

Se manejan dos cosas que la API puede devolver:

- **`stop_reason: "refusal"`** — un documento de identidad puede hacer saltar un
  clasificador. Se comprueba **antes** de tocar `content`, que en un rechazo
  viene vacío.
- **`fallbacks: 'default'`** — si un clasificador declina, la petición se
  reintenta sola en otro modelo en la misma llamada, en vez de morir.

Las imágenes van como bloques `image` y los PDF como bloques `document`, ambos en
base64.

### Los dos topes del esquema

Los structured outputs tienen **dos límites distintos**, y los dos se manifiestan
igual: un `400` que tumba de golpe **toda** lectura de ese tipo de documento, en
producción, sin aviso previo y sin que ningún test lo note.

| Tope | Cuánto | Qué lo gasta |
|---|---|---|
| Uniones `anyOf` | 16 por esquema | Cada campo *nullable*. Los `simple: true` no gastan. |
| Tamaño de la gramática compilada | **14 campos** con la forma `{valor, confianza, nota}` | Todos los campos, gasten unión o no. |

**El que muerde primero es el segundo**, y por bastante. El perfil `dni` llegó a
17 campos gastando solo 11 uniones: pasaba de sobra el presupuesto de `anyOf`
—que era lo único que se vigilaba— y aun así devolvía
`compiled grammar is too large`. Estuvo así desde que se añadieron los campos de
OEGAM: la función seguía respondiendo `200` porque cada documento se captura por
separado, así que en los logs no había ningún error, solo DNIs que no rellenaban
nada.

Los dos números están medidos contra la API, no deducidos: con 14 campos compila
y con 15 no. Por eso ahora:

- `MAX_CAMPOS_ESQUEMA = 14` en `gestia-extraer`, y un bloque que se pase **hace
  fallar el arranque de la función**, no una lectura suelta.
- `tools/verificar-oegam.js` cuenta **campos por bloque**, no solo uniones.

Si un perfil necesita más campos, la salida no es apretar el esquema: es
**partirlo en otro bloque**, como el DNI.

> El modelo se cambia en una constante (`MODELO`) al principio de la función.
> Con un volumen alto y documentos limpios, un modelo menor puede salir a
> cuenta; conviene medirlo contra un lote real antes de bajarlo, porque el coste
> de un dato mal leído aquí no es el coste de un token.

---

## Objetos creados

- Columnas en `gestotrafic_expedientes`: `ia_estado`, `ia_extraccion`,
  `ia_modelo`, `ia_validado_por`, `ia_validado_at`
- Edge Function `gestia-extraer` (`verify_jwt: true`)
- `assets/js/gestia.js` · traduce la extracción a campos del catálogo
- Ruta `#/gest-ia`

Todo bajo el prefijo `gestotrafic_*` / `gestia-*`. El sistema de clientes no se
toca.

---

Hecho por **WhiteMoon Agencia IA** · whitemoon.es
