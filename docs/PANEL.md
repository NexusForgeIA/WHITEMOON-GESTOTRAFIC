# Panel de gerencia

La pantalla con la que se decide: qué entra, cuánto se tarda, dónde se atasca,
qué agente lleva qué y qué hay que hacer hoy.

Vive en tres piezas que no se pisan:

| Pieza | Qué hace |
|---|---|
| [`assets/js/panel.js`](../assets/js/panel.js) | **Cuenta.** No pinta nada. Se ejecuta en node. |
| `vistaDashboard()` en [`assets/js/app.js`](../assets/js/app.js) | **Pinta** el modelo que devuelve `GTPanel.calcular()`. |
| `GTApi.datosPanel()` en [`assets/js/api.js`](../assets/js/api.js) | Trae las filas. No agrega nada en SQL. |

```bash
node tools/verificar-panel.js
```

Las cuentas no se hacen en SQL a propósito: agregadas en el servidor, el panel
sería la única versión de sí mismo y no habría forma de comprobarlo sin volver
a escribirlo. Con el cálculo en un módulo puro, el verificador lo ejecuta de
verdad —no una copia— y lo somete a 49 comprobaciones.

---

## ⛔ La regla que manda aquí

**Una métrica sin dato dice que no lo tiene.** No devuelve 0, no promedia «lo
que hay más o menos», no interpola.

Un 0 y un «no se sabe» se pintan parecido y significan lo contrario. *«0 días
de media en documentación»* es un equipo impecable; lo que pasaba de verdad era
que nadie había registrado todavía un cambio de estado. Nadie audita un número
redondo y creíble, y esa es exactamente la forma en la que un panel falla.

Por eso cada métrica que puede quedarse sin respaldo viaja con
`sinDatos: true`, `valor: null` y un `motivo` en castellano, y la vista está
obligada a enseñar el motivo en lugar del número. El CSV hace lo mismo: esas
celdas salen **vacías**, porque una hoja de cálculo suma y promedia, y un cero
de relleno se convierte en un total falso en cuanto alguien arrastra una
fórmula.

---

## De dónde sale cada número

### Lo que se sabe desde siempre

| Métrica | Origen |
|---|---|
| Expedientes nuevos | `expedientes.created_at` |
| Embudo por estado | `expedientes.estado` (foto de HOY) |
| Por tipo de trámite | `expedientes.tipo_tramite` |
| % altas con Gest-IA | `expedientes.ia_estado` |
| Facturación | `datos->>'honorarios'`, vía `GTHonorarios` |
| Activos por agente | `expedientes.gestor_id` + `estado` |
| Alertas | `GTServicio`, `GTValidaciones`, catálogo de trámites, `documentos` |

### Lo que necesita el historial

`gestotrafic_estado_historial` guarda **cada cambio de estado con su fecha**.
Sin esa tabla no existen los tiempos, y **no se pueden deducir**: `updated_at`
cambia al guardar cualquier cosa —los honorarios, el ITP, una nota— y usarlo
daría tiempos cortos, creíbles y que no ha medido nadie.

| Métrica | Necesita |
|---|---|
| Tiempo medio de tramitación | alta + cierre en el historial |
| Tiempos por estado / cuello de botella | recorrido completo del expediente |
| Cerrados en el periodo | una fila `completado` con fecha |

---

## El historial lo escribe un trigger

No la aplicación. Un registro que hay que acordarse de escribir en cada sitio
que cambia el estado —la ficha, el Kanban, el arrastre entre columnas, lo que
se añada mañana— se queda a medias en cuanto aparece el sitio nuevo. Y **un
historial con huecos miente peor que uno vacío**: los tiempos salen cortos y
parecen buenos.

```
gestotrafic_expedientes ──┬─ AFTER INSERT ─────────────────────┐
                          └─ AFTER UPDATE OF estado            │
                             WHEN old.estado IS DISTINCT FROM  │
                                  new.estado                   ▼
                                        gestotrafic_estado_historial
```

| Columna | Qué es |
|---|---|
| `estado` | el estado al que se ha llegado |
| `estado_anterior` | del que se venía · **`NULL` solo en el alta** |
| `gestor_id` | a quién estaba **asignado** el expediente en ese momento |
| `autor_id` | quién **hizo** el cambio (`auth.uid()`); `NULL` si fue el servidor |
| `created_at` | cuándo |

Guardar la ficha veinte veces sin tocar el estado no deja veinte filas: el
`UPDATE OF estado` + `IS DISTINCT FROM` solo registra lo que de verdad se movió.

**Desde el navegador es de SOLO LECTURA.** La tabla no tiene `insert` para
nadie; la única forma de escribir en ella es el trigger, que es
`SECURITY DEFINER`. El historial es la prueba de cuánto se tardó, y una prueba
que se puede editar a mano no lo es.

El RLS es el mismo que el del expediente —el admin todo, el gestor lo suyo— y
no se reimplementa: la política pregunta a la tabla padre.

---

## Qué se mide y qué no

### Las duraciones solo cuentan expedientes con el alta registrada

De un expediente cuya historia empieza a la mitad se sabe lo que pasó desde
entonces, pero **no cuánto llevaba antes**. Meterlo en la media la acorta: uno
que entró hace 20 días y cuya primera fila es de anteayer mediría 2 días.

Es exactamente lo que pasa con los expedientes que ya existían cuando se creó
la tabla, y por eso **no se rellenó el historial hacia atrás**. Inventar un
alta a partir de `created_at` habría dado un panel bonito el primer día y
tiempos falsos para siempre.

### Los cierres sí se cuentan todos

Una fila `completado` es un cierre real, con alta registrada o sin ella. Lo que
se avisa es otra cosa: si el historial **empieza más tarde que el periodo**, el
panel lo dice, porque los cierres anteriores a esa fecha no constan en ningún
sitio y un «3 cierres» se leería como si fueran los únicos tres del mes.

### El tramo abierto cuenta desde ya

Un expediente lleva veinte días atascado en documentación **mientras** está
atascado, no cuando por fin sale. El último tramo se mide hasta hoy.

`completado` no genera tramo: de ahí no se sale, así que su «duración» sería lo
que lleve archivado, que no es tiempo de trabajo de nadie.

### La tabla por agente suma el total

Un expediente sin `gestor_id`, o de un usuario que ya no está en la lista, no
se cae de la tabla en silencio: va a una fila **«Sin asignar»**. Quien compare
la columna «nuevos» con el indicador de arriba encontraría si no una diferencia
sin explicación, y lo natural es pensar que el indicador está mal.

Un gestor **desactivado** con trabajo pendiente también sale, marcado: el
expediente sigue existiendo aunque él ya no entre.

---

## Periodos y variación

Ventanas **medio abiertas**, `desde` incluido y `hasta` excluido. Cerradas por
los dos lados, un expediente dado de alta el día 1 a las 00:00 contaría en dos
meses.

| Periodo | Ventana | Se compara con |
|---|---|---|
| Este mes | mes natural en curso | el mes anterior |
| Mes anterior | el mes natural anterior | el de antes |
| Este trimestre | trimestre natural en curso | el trimestre anterior |

La ventana previa es siempre **la equivalente**: mes contra mes y trimestre
contra trimestre. Comparar un trimestre con un mes daría una caída del 70 % que
solo existe en la aritmética.

**El porcentaje se queda en `null` cuando el periodo anterior valía 0.** Un
«+100 %» al pasar de 0 a 7 dice algo distinto de lo que ocurrió; se enseña la
diferencia absoluta, que sí es cierta.

Cada métrica declara si subir es buena noticia (`mejorSi`). En el tiempo medio
de tramitación **subir es malo**, y se colorea al revés que las demás.

---

## Facturación · qué entra y qué no

| Concepto | ¿Entra? | Por qué |
|---|---|---|
| Honorarios | **SÍ** | es lo que factura la gestoría |
| IVA | NO | se repercute y se ingresa en Hacienda |
| ITP | NO | es un impuesto: dinero del cliente que pasa por caja |
| Tasa DGT | NO | es un **suplido** (art. 78.Tres.3.º LIVA) |

Cuál es «los honorarios» de un expediente lo decide `GTHonorarios`, que es de
donde sale la factura. Si el panel lo leyera por su cuenta serían dos cifras
que pueden separarse.

Se atribuyen al periodo en que el expediente se dio de alta: los honorarios no
llevan fecha propia.

---

## Alertas accionables

No dependen del periodo —un DNI caducado no deja de estarlo porque cambie el
mes— pero sí respetan los filtros de agente y trámite.

| Alerta | Regla | Vive en |
|---|---|---|
| Bloqueado por cambio de servicio | el código de clasificación tiene que cambiar y la ficha aún no lo refleja | [`servicio.js`](../assets/js/servicio.js) |
| DNI caducado | `<parte>_caducidad_nif` anterior a hoy | panel (las empresas quedan fuera) |
| Documentación pendiente | falta un obligatorio del trámite y han pasado más de **5 días** | catálogo de [`tramites.js`](../assets/js/tramites.js) |
| Datos que no cuadran | letra de control, matrícula, bastidor, obligatorios en blanco | [`validaciones.js`](../assets/js/validaciones.js) |

**Ninguna regla se escribe en el panel**: se le preguntan a los módulos que ya
las tienen, para que el panel no sea una segunda opinión que se desvía. Taxi →
Particular no aparece como bloqueado, porque comparten el código 1000 y mandar
a la ITV a quien no tiene que ir es un error tan real como el contrario.

Y los avisos **no dicen cuál sería el valor bueno**: decir la letra correcta de
un NIF invita a escribirla sin mirar el documento.

Un expediente correcto no genera ninguna alerta, y eso se verifica: un panel
que avisa de más se ignora entero, y entonces deja de avisar de lo que importa.

---

## Permisos

El panel **no filtra por gestor**: lo hace el RLS, el mismo que en todo el CRM.

| | Admin | Gestor |
|---|---|---|
| Expedientes e historial | todos | los suyos |
| Tabla por agente | todos los agentes | solo su fila |
| Filtro de agente | sí | no se muestra (no hay nadie más) |
| Cabecera | «Todos los expedientes de la gestoría» | «Tus expedientes asignados» |

Aunque se manipulase `panel.js` en el navegador, el servidor no devolvería
expedientes de otro gestor.

---

## Exportar

- **CSV** · punto y coma y BOM, que es como lo abre el Excel en español; decimal
  con coma. Lo que en pantalla dice «sin datos suficientes» sale **vacío**.
- **Imprimir / PDF** · hoja de estilo de impresión: se va el menú oscuro y queda
  el panel en papel con los mismos números.
