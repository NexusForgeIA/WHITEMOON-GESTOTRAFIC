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
| DNI / NIE | nombre, apellidos, número, domicilio |
| CIF / empresa | razón social, CIF, domicilio social |
| Ficha técnica | marca, modelo, bastidor, matrícula, 1ª matriculación, combustible, CVf |
| Permiso de circulación | titular, matrícula |
| Contrato / factura | precio, fecha, vendedor, comprador |

Cada campo vuelve con `valor`, `confianza` (alta/media/baja) y `nota`. Los tipos
que no se leen automáticamente (certificados del CAT, denuncias, «otros») se
suben igual y quedan en el checklist.

Si dos documentos aportan el mismo campo, gana el de **más confianza**; a
igualdad, el primero. **Un `null` nunca pisa un valor leído.**

### 3 · El ITP

Se calcula solo con el motor real `gestotrafic-itp` en cuanto termina la lectura.
Necesita dos datos que **no están en ningún documento**:

- **valor BOE (Anexo I)** — sale de la tabla de precios medios
- **CCAA del comprador** — es una decisión, no un dato del papel

Los dos se piden al gestor en la pantalla de subida, señalados como tales. El
precio de contrato y la fecha de matriculación sí salen de los documentos, así
que el cálculo se completa sin más intervención.

#### Por qué Gest-IA no elige la versión del turismo

En motos, quads y buggys el Anexo I tarifa por tramo de cilindrada o de kW, así
que el valor base sale solo del dato de la ficha técnica.

En turismos no: el Anexo I lista **61.634 versiones** y la ficha técnica no trae
la denominación comercial exacta del BOE. Gest-IA lee «Modelo» (campo D.3) y con
eso se preselecciona **marca y modelo** —que solo sirven para navegar— y se
**propone** la versión más parecida, marcada con `★ propuesta IA`. La versión
queda **sin elegir**: la confirma el gestor.

No es una precaución de más. En el Anexo I hay **5.107 denominaciones que se
repiten dentro de su marca con precios distintos**: `CLIO 1.5 DCI Authentique
3p`, por ejemplo, existe con 48, 63 y 66 kW y vale 10.500, 11.400 u 11.600 €.
Lo que las distingue son los kW de la ficha técnica, no el nombre. Elegir a
ciegas entre esos tres precios sería inventar el valor base.

Si ninguna versión se parece lo suficiente, o si las dos mejores empatan, no se
propone ninguna: se avisa en ámbar y se pide selección manual.

### 4 · La validación es obligatoria

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
