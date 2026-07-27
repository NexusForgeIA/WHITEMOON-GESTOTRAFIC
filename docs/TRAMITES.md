# Catálogo de trámites

Los trámites de GestoTrafic son **configurables**. Todo lo que distingue a un
trámite de otro —qué campos se capturan, qué documentos hay que pedir, si lleva
cálculo fiscal y si genera un documento— vive en una sola entrada de
[`assets/js/tramites.js`](../assets/js/tramites.js).

**Añadir un trámite nuevo es añadir una entrada.** No hay que tocar el
formulario, ni el Kanban, ni la subida de documentos, ni la base de datos.

---

## Trámites incluidos

| Trámite | Cálculo fiscal | Genera documento | Docs obligatorios |
|---|---|---|---|
| Transferencia de vehículo | **ITP** (`gestotrafic-itp`) · exención manual | Contrato de compraventa | 5 (varían según vendedor) |
| Matriculación | — (IEDMT manual) | — | 5 |
| Notificación de venta | — | Comunicación de venta | 4 |
| Baja temporal | — | — | 3 |
| Baja definitiva | — | — | 3 + 1 según motivo |
| Duplicado del permiso de circulación | — | — | 2 + 1 si robo |
| Duplicado de ficha técnica (eITV) | — | — | 2 |

---

## Anatomía de una entrada

```js
{
  id: 'baja_temporal',            // clave estable → expedientes.tipo_tramite
  nombre: 'Baja temporal',        // etiqueta larga
  corto: 'Baja temporal',         // etiqueta para tablas y tarjetas
  descripcion: '…',               // se ve en el selector de tipo
  icono: ICO.pausa,               // path SVG 24x24
  calculo: null,                  // 'itp' → añade la pestaña de cálculo
  genera: null,                   // 'contrato' | 'comunicacion' | null
  aviso: '…',                     // nota destacada dentro del expediente (opcional)

  secciones: [
    { t: 'Datos del vehículo', campos: [marca, modelo, matricula] },
    { t: 'Titular', campos: titular, copiarCliente: true },
    { t: 'Motivo de la baja', campos: [{ n:'motivo', l:'Motivo', t:'select', req:1, op:[…] }] }
  ],

  docs: [D.dniTitular, D.permiso, D.fichaTecnica, D.otros]
}
```

### Campos

| Clave | Significado |
|---|---|
| `n` | nombre del campo |
| `l` | etiqueta visible |
| `t` | `text` · `date` · `number` · `select` · `textarea` · `empresa` |
| `col` | `1` → se guarda en su **columna** de la tabla; si se omite, va a `datos` (jsonb) |
| `req` | obligatorio |
| `ph` | placeholder |
| `op` | opciones del `select` (strings, o `{v,l}`) |
| `def` | valor por defecto |
| `paso` | `step` para números |
| `full` | ocupa el ancho completo |
| `soloSi` | `{campo, valor}` → el campo solo se muestra si otro campo tiene ese valor |
| `autoSi` | el campo lo rellena la aplicación (solo lectura) en ese modo |
| `lSi` | etiqueta alternativa cuando el campo está en modo `autoSi` |

`t: 'empresa'` renderiza un desplegable con los **clientes de tipo empresa**
del CRM. Se usa para elegir la empresa vendedora de una transferencia.

**Regla práctica:** usa `col: 1` solo si el campo se consulta o se lista (marca,
modelo, matrícula, titular…). Todo lo específico de un trámite va a `datos`,
que es lo que evita tener que migrar la base de datos por cada trámite nuevo.

### Documentos

```js
{ tipo: 'certificado_destruccion', label: 'Certificado de destrucción (CAT)', obligatorio: true,
  si: (exp) => leer(exp, 'motivo') === 'destruccion' }
```

`si` es opcional y hace el documento **condicional**: solo aparece en el
checklist si la función devuelve `true`. Se usa para pedir el certificado del
CAT solo en bajas por destrucción, el justificante de exportación solo en bajas
por exportación, y la denuncia solo en duplicados por robo.

`tipo` es texto libre: la restricción `CHECK` que había sobre
`gestotrafic_documentos.tipo` se eliminó precisamente para que un checklist
nuevo no exija una migración.

---

## Cómo añadir un trámite

1. Añade la entrada a `TRAMITES` en `assets/js/tramites.js`.
2. Nada más.

Automáticamente aparece en el selector de tipo, genera su formulario, valida sus
campos obligatorios, guarda en columna o en `datos` según corresponda, muestra
su checklist, entra en el Kanban y aparece en el filtro por trámite del listado.

---

## Qué NO configura el catálogo

- **Los estados.** El flujo `nuevo → documentación pendiente → en tramitación →
  presentado → completado` es común a todos los trámites y sigue siendo una
  máquina de estados cerrada (`CHECK` en base de datos).
- **El motor de cálculo.** `calculo: 'itp'` enchufa la Edge Function
  `gestotrafic-itp`. Un cálculo distinto (por ejemplo el IEDMT) necesitaría su
  propio motor: no se improvisa desde el catálogo.

---

## Partes particular o empresa en la Transferencia

La transferencia distingue **quién vende** y **quién compra**:

| | Particular | Empresa / concesionario |
|---|---|---|
| Datos del vendedor | se escriben a mano | se **vuelcan** de su ficha de cliente (solo lectura) |
| Identificación | DNI / NIE de esa parte | **CIF** de esa parte |
| Documento de la venta | **Contrato de compraventa** | **Factura de venta** |
| ITP | lo calcula `gestotrafic-itp` | lo calcula igual, salvo exención confirmada |

Un particular se identifica con su DNI/NIE y una empresa con su CIF: **pedir el
documento que no toca deja el expediente sin la identidad fiscal correcta** de
esa parte. Por eso el checklist es condicional y no una lista fija.

El tipo se guarda en `datos.vendedor_tipo` / `datos.comprador_tipo` y la empresa
vendedora elegida en `datos.vendedor_empresa_id`. Los datos siguen escribiéndose
en las mismas columnas de siempre (`vendedor_nombre`, `vendedor_nif`,
`comprador_nif`…): **no hubo migración de esquema**.

Las dos partes no son simétricas: solo el **vendedor** tiene selector de empresa
del CRM y volcado automático. El comprador cambia la etiqueta de sus campos
(*DNI / NIF* → *CIF*) y el documento que se le pide, pero se escribe a mano o se
copia del cliente del expediente.

El checklist se adapta con la misma mecánica de `si` que el resto del catálogo.
Como los `si` leen del expediente, **el alta con Gest-IA pregunta el tipo de
cada parte antes de subir nada**: sin expediente todavía creado, la lista se
construiría siempre en modo particular.

### Exención de ITP · decisión del gestor, nunca automática

Cuando una empresa vende con **factura sujeta a IVA**, la transmisión suele
quedar **exenta de ITP**. GestoTrafic **no lo deduce solo**: expone un toggle
—*Operación con factura (exenta de ITP)*— que confirma el gestor.

Al marcarlo:

- `itp_importe` pasa a **0** y el expediente muestra **Exento**
- `total_impuestos` se reduce a la **tasa DGT** (que se sigue liquidando)
- `datos.itp_exento` queda a `true`
- `calculo_json` **conserva íntegro** el resultado del motor, de modo que la
  exención es auditable y **reversible**: al desmarcarla se recupera el importe

La transferencia entre particulares no cambia: calcula el ITP con
`gestotrafic-itp` exactamente como antes.

---

## Sobre el IEDMT en Matriculación

El **IEDMT** (impuesto de matriculación) es un impuesto **distinto del ITP** y el
motor `gestotrafic-itp` no lo cubre. La matriculación por tanto **no lleva
cálculo automático**: expone un campo de importe manual y una nota, y muestra un
aviso dentro del expediente dejando claro que **lo calcula y lo aporta la
gestoría**.

---

Hecho por **WhiteMoon Agencia IA** · whitemoon.es
