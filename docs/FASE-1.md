# GestoTrafic · Fase 1 (MVP)

CRM de demostración para gestorías de tráfico, con la Calculadora ITP integrada.
Construido con el sistema de diseño WhiteMoon (dark premium, Sora, `#7c4dff` / `#00d4aa`).

---

## ⛔ Alcance regulado

**GestoTrafic no se conecta con la DGT ni con la Agencia Tributaria.**
No presenta expedientes ante ningún organismo, no liquida el modelo 620 y no
solicita citas. La gestoría presenta el expediente con el programa oficial de su
colegio; GestoTrafic lo deja **listo para presentar**.

El aviso es visible dentro de la aplicación (dashboard, alta de expediente, ficha
de expediente) y en el pie del contrato generado.

---

## Módulos incluidos

| # | Módulo | Estado |
|---|--------|--------|
| 0 | **Gest-IA**: alta de expedientes leyendo los documentos con IA | ✅ |
| 0 | Multiusuario: alta de gestores y aislamiento por RLS | ✅ |
| 1 | Login real contra `gestotrafic_usuarios` (bcrypt) | ✅ |
| 2 | Dashboard con KPIs | ✅ |
| 3 | Fichas de clientes (particular / empresa) + historial | ✅ |
| 4 | Expedientes de transferencia + Kanban drag & drop | ✅ |
| 5 | Calculadora ITP integrada (BOE 2026) | ✅ |
| 6 | Captura de documentación + checklist | ✅ |
| 7 | Contrato de compraventa pre-rellenado | ✅ |

### 1 · Login multiusuario

Credenciales de demostración:

| Usuario | Contraseña | Rol | Ve |
|---------|-----------|-----|-----------|
| `admin`  | `demo` | Administrador | Todos los expedientes · panel de Gestores |
| `gestor` | `demo` | Gestor (Laura Ortega) | Solo sus expedientes |
| `marcos` | `demo` | Gestor (Marcos Delgado) | Solo sus expedientes |

**La autenticación es real.** Las credenciales se verifican en la Edge Function
`gestotrafic-auth` contra el hash **bcrypt** de `gestotrafic_usuarios`, que
devuelve una sesión de Supabase firmada. El aislamiento entre gestores lo impone
el **RLS** de la base de datos, no la interfaz.

Detalle completo, incluida la matriz de lo que está cerrado y por qué, en
[`USUARIOS.md`](USUARIOS.md).

### 2 · Dashboard

KPIs ligeros: expedientes activos, expedientes del mes, clientes totales e
impuestos calculados en el mes. Barras de expedientes por estado y tabla de los
últimos expedientes.

### 3 · Clientes

Alta de **particular** (nombre, apellidos, NIF) o **empresa** (razón social, CIF),
con contacto, dirección y notas. La ficha muestra el historial completo de
trámites del cliente.

Los clientes de tipo **empresa** son además el origen del vendedor cuando una
transferencia la vende un concesionario: sus datos se vuelcan al expediente en
lugar de reescribirse a mano.

### 4 · Expedientes y Kanban

Trámite estrella: **transferencia de vehículo**. Datos del vehículo (marca,
modelo, matrícula, fecha de matriculación, combustible, cilindrada, CVf, etiqueta
DGT), datos de vendedor y comprador, y fiscalidad.

> Desde la ampliación de trámites hay **7 tipos** (matriculación, notificación de
> venta, bajas y duplicados). Cada uno declara sus campos y su checklist en el
> catálogo: ver [`TRAMITES.md`](TRAMITES.md).

Referencia automática `EXP-AAAA-NNNN` mediante secuencia de Postgres (sin
triggers).

**Buscador por matrícula o documento.** Un solo campo con lupa, encima del
listado: detecta si le das una matrícula o un DNI/NIF/CIF y busca por los dos.
El término se normaliza —mayúsculas y solo alfanuméricos—, así que `4821 NBH`,
`4821-NBH` y `4821nbh` son lo mismo, y `71.640.935-D` encuentra a `71640935D`.
Busca en las columnas (`matricula`, los `*_nif`, el NIF del cliente) y también
dentro del jsonb `datos`, bajo claves de matrícula o de documento, porque no
todos los trámites tienen columna propia.

La búsqueda es enlazable: `#/expedientes?q=4821NBH`.

> La resuelve `gestotrafic_buscar_expedientes`, que es **SECURITY INVOKER a
> propósito**: se ejecuta con los permisos de quien llama, así que el filtrado
> por gestor lo hace el **RLS de siempre** y no una segunda copia de la regla.
> Un gestor solo encuentra los suyos; el admin, todos. Comprobado con un NIF que
> aparece en expedientes de dos gestores distintos: cada uno ve solo el suyo.

Estados en tablero Kanban con drag & drop nativo HTML5:

```
nuevo → documentación pendiente → en tramitación → presentado → completado
```

El tablero muestra el **nº de expedientes por estado** en dos sitios: una tira
de KPIs sobre el tablero y el contador de cada columna, ambos con el color del
estado. Los dos se recalculan al soltar una tarjeta.

El **selector de estado** de la ficha de expediente no es un `<select>` nativo:
un desplegable nativo pinta su lista con los colores del sistema operativo y
sobre fondo oscuro las opciones no seleccionadas quedan ilegibles. Se sustituyó
por un desplegable propio (`gt-sel`) navegable con teclado, con **16,1:1** de
contraste en las opciones normales y **18,3:1** en la seleccionada (AAA). En el
resto de desplegables nativos de la aplicación el contraste de `option` se
fuerza por CSS.

El movimiento es optimista: la tarjeta se coloca al soltar y se revierte si la
escritura en Supabase falla. En dispositivos táctiles (`pointer: coarse`), donde
no existe drag & drop nativo, cada tarjeta muestra un selector de estado.

### 5 · Calculadora ITP — el módulo clave

El cálculo **no se ha reimplementado**. Se ha reutilizado el motor de producción
de `whitemoon.es/calculadora-itp/` (BOE 2026 · **Orden HAC/1501/2025**), portado
verbatim a la Edge Function `gestotrafic-itp`:

- Tabla de depreciación del **Anexo IV** (`tablaTurismos`)
- Tipos autonómicos por CCAA, tipo para **>15 CVf**, y tipos reducidos por
  **etiqueta 0 / ECO**
- **Cuotas fijas** autonómicas (Aragón, Canarias, Cantabria, Galicia, Murcia y
  Comunitat Valenciana)
- **Exenciones** por antigüedad y valor (Cataluña, Navarra)
- Reducción del **70%** por uso especial (taxi, autoescuela, alquiler)
- Base imponible = el mayor entre valor fiscal y precio de contrato
- **Tasa DGT 4.1** (cambio de titularidad): **55,70 €**, la misma cifra que usa
  `whitemoon.es/calculadora-transferencia-vehiculo/`

Devuelve `valor_venal`, `base_imponible`, `itp`, `tasa_dgt`, `total_impuestos` y
un `detalle` con la traza completa del cálculo, que se guarda en el expediente
(`calculo_json`) para poder auditarlo después.

**Contrato de la función**

```jsonc
// POST https://<proyecto>.supabase.co/functions/v1/gestotrafic-itp
{
  "valor_boe": 21000,                    // precio Anexo I (obligatorio)
  "fecha_matriculacion": "2019-06-12",   // obligatorio
  "fecha_transmision": "2026-07-25",
  "ccaa": "Comunidad de Madrid",
  "cilindrada": 1498,
  "cvf": 11.5,
  "etiqueta_dgt": "",                    // "", "B", "C", "ECO", "0"
  "uso_especial": false,
  "precio_contrato": 8500,
  "tipo_vehiculo": "coche"               // "coche" | "moto"
}
```

Caso verificado en la demo:

> 21.000 € × 28% (más de 7 años, hasta 8) = **valor venal 5.880 €**.
> Precio de contrato 8.500 € > valor fiscal → **base imponible 8.500 €**.
> Madrid 4% → **ITP 340,00 €** + **tasa DGT 55,70 €** = **395,70 €**.

**Exención por factura de empresa.** Si el vendedor es una empresa que emite
factura sujeta a IVA, la transmisión suele quedar exenta de ITP. GestoTrafic
**no lo decide solo**: el gestor lo confirma con un toggle. Al marcarlo el ITP
queda en 0 y el total se reduce a la tasa DGT (mismo caso: 395,70 € → 55,70 €).
`calculo_json` conserva íntegro el resultado del motor, así que la exención es
auditable y reversible. Detalle en [`TRAMITES.md`](TRAMITES.md).

### 5 · Validaciones previas del expediente

Repaso de los datos que ya hay, **antes** de tramitar o de generar el XML. Sale
en la ficha, encima de las pestañas, y desaparece solo cuando no queda nada:

| Comprobación | Qué caza |
|---|---|
| **NIF / NIE / CIF** | la letra (o dígito) de control de todos los intervinientes: titular, comprador, vendedor |
| **Matrícula** | que no encaje ni con el formato europeo (0000 BBB) ni con el provincial antiguo (M 0000 XX) |
| **Bastidor (VIN)** | que no tenga exactamente 17 alfanuméricos — o que lleve **I, O o Q**, que un VIN no usa nunca y suelen ser un 1 o un 0 mal leídos |
| **Obligatorios** | los que exige el trámite y están en blanco: el *motivo* del duplicado, el de la baja… |

> Son **AVISOS, no bloqueos**, y GestoTrafic **no corrige nada**. El aviso de un
> NIF ni siquiera dice cuál sería la letra correcta: decirla invita a
> escribirla sin mirar el documento, que es justo cómo se acaba inscribiendo a
> otra persona. La última palabra la tiene el papel que el gestor tiene delante.

La otra mitad importa igual: **un expediente correcto no genera ni un aviso**.
Un validador que avisa de más se acaba ignorando, y entonces deja de avisar de
lo que importa. Por eso `caducidad_nif` —que acaba en `_nif` pero es una
fecha— no entra en la revisión de documentos, y un obligatorio que ahora mismo
está oculto no se reclama.

Los obligatorios salen del **catálogo del trámite**, así que el *motivo* del
duplicado y el de la baja entran solos: no hay una lista aparte que mantener.

```bash
node tools/verificar-validaciones.js
```

### 5 · bis · Cambio de servicio y bloqueo por clasificación

Un vehículo que ha estado dado de alta como **VTC** o como **alquiler sin
conductor** no se transfiere a particular sin más: su **ficha técnica** lleva
otro código de clasificación y hay que pasar por la **ITV** a cambiarlo antes.

La transferencia trae un toggle *¿El vehículo cambia de servicio?* (por defecto
**no**) y, al marcarlo, los desplegables de **servicio actual** y **servicio de
destino**. Dos cosas distintas, que aquí no se mezclan:

- **Registrar** el cambio · pasa **siempre** que se marque, haya bloqueo o no.
  Sale en el XML como `CAMBIO_SERVICIO = SI`.
- **Bloquear** la tramitación · solo cuando el **código** de clasificación tiene
  que cambiar y la ficha técnica todavía no lo refleja.

| Servicio | Código |   | Cambio | ¿Bloquea? |
|---|---|---|---|---|
| Particular | 1000 |  | Taxi → Particular (1000 → 1000) | **no** · se transfiere ya |
| Taxi | 1000 |  | VTC → Particular (1041 → 1000) | **sí** · hasta que la ficha ponga 1000 |
| VTC | 1041 |  | ASN → Particular (1003 → 1000) | **sí** · ídem |
| ASN | 1003 |  | | |

> **La regla es por CÓDIGO, no por etiqueta.** Taxi y Particular comparten el
> 1000: ese cambio de servicio se registra, pero la ficha técnica no cambia y no
> hay nada que pedir en la ITV. Mandar allí a quien no tiene que ir es un error
> tan real como dejar pasar al que sí.

Bloqueado, el expediente **no pasa a tramitación** —el selector de estado lo
rechaza y dice por qué— y la ficha muestra el aviso con el cambio exacto:
*«El cliente debe solicitar en la ITV el cambio de clasificación 1041→1000. La
ficha técnica debe reflejar el código 1000 antes de transferir.»*

Se desbloquea de dos maneras: cuando el **código de la ficha técnica** pasa a
ser el de destino —lo lee **Gest-IA** al subirla, o lo escribe el gestor
mirándola— o cuando el gestor marca que la ITV ya lo ha hecho, que es una
confirmación suya y queda como tal.

**Anti-invención.** Solo hay tres códigos y son los que ha confirmado la
gestoría. Un servicio sin código va con `null`, y eso **no** quiere decir «no
bloquea»: quiere decir que no se puede decidir, así que bloquea y lo pide. Si
Gest-IA no lee el código con seguridad, queda en blanco y el expediente sigue
bloqueado hasta que alguien lo mire.

**Gest-IA aplica exactamente la misma regla**: lee `clasificacion_codigo` de la
ficha técnica, lo deja en el expediente y a partir de ahí decide la misma
función. El aviso es literalmente el mismo por los dos caminos.

En el XML: `CAMBIO_SERVICIO` sale SI/NO —lo confirma la plantilla—, pero
`SERVICIO_ANTERIOR`, `SERVICIO` y `SERVICIO_DESTINO` salen **vacíos y marcados**:
son el catálogo de servicios de **OEGAM**, que es otra tabla y no la tenemos.
El informe dice qué servicio es y con qué código de clasificación.

```bash
node tools/verificar-servicio.js
```

### 5 · ter · Honorarios y total al cliente

Lo que se liquida a Hacienda y lo que se le **cobra al cliente** son cuentas
distintas, y por eso van en pestañas distintas. La de *Honorarios y total*
añade lo único que falta —lo que cobra la gestoría— y arma la factura:

| Concepto | IVA | De dónde sale |
|---|---|---|
| ITP de la transmisión | **NO** · es un impuesto | del cálculo guardado |
| Tasa DGT | **NO** · es un **suplido** | del cálculo guardado |
| Honorarios de la gestoría | **sí, es la base** | lo pone el gestor |
| IVA (21% por defecto, editable) | — | `honorarios × tipo` |

> ⛔ **El IVA se aplica SOLO a los honorarios.** No es una preferencia de
> presentación: un suplido no forma parte de la base imponible del IVA
> (art. 78.Tres.3.º LIVA) y un impuesto no se grava con otro impuesto. Meter la
> tasa DGT o el ITP en esa base le cobra al cliente un dinero que no debe, y es
> un error que **no se ve**: el total sale más alto y parece igual de correcto.
>
> Por eso la multiplicación por el tipo está en **un solo sitio**
> ([`assets/js/honorarios.js`](../assets/js/honorarios.js)) y tiene su propio
> verificador, que la comprueba de cinco maneras — incluida la más directa: sin
> honorarios **no hay IVA ninguno**, por mucho ITP y mucha tasa que haya.

Sobre el mismo caso de arriba, con 100 € de honorarios:

> ITP 340,00 € + tasa DGT 55,70 € + honorarios 100,00 € + IVA 21,00 €
> = **total a cobrar 516,70 €**.

**Anti-invención.** Los honorarios los pone el gestor: no hay tarifa automática
ni estimación. El ITP y la tasa se leen del cálculo guardado y **no se
recalculan aquí**. Si falta alguna de las dos cosas, el total suma solo lo que
hay y el desglose dice qué falta, en vez de cerrar un presupuesto con una cifra
inventada.

Se guarda en `datos` (sin migración): `honorarios`, `honorarios_iva_tipo` y
`honorarios_total_cliente`. Ese último es una cuenta de cifras que ya están en
el expediente, así que **se recalcula en los tres caminos que las mueven**
—guardar honorarios, calcular el ITP y marcar la exención—, todos por la misma
función. Un total antiguo contradiciendo a las otras cuatro cifras es
exactamente lo que no puede quedar guardado.

Este desglose es para el **cliente** (presupuesto o factura). **No va al XML de
OEGAM**: ese formato no tiene campo de importe, igual que pasa con el ITP (ver
[`OEGAM.md`](OEGAM.md)).

```bash
node tools/verificar-honorarios.js
```

### 6 · Documentación

Checklist por trámite con 5 documentos obligatorios y 2 opcionales (ITV, otros).
En la transferencia el checklist **se adapta a quién vende y quién compra**: de
un particular pide su *DNI / NIE*; de una empresa, su *CIF*. Y el documento de
la venta es un *Contrato de compraventa* entre particulares o la **Factura de
venta** si vende una empresa. El alta con Gest-IA pregunta el tipo de cada parte
antes de subir, porque el expediente todavía no existe para deducirlo.
Cada documento tiene estado *pendiente* / *recibido*, barra de progreso, y se
sube (foto o escaneo, JPG/PNG/PDF, máx. 10 MB) al bucket aislado
`gestotrafic-docs` de Supabase Storage. Subir un documento del mismo tipo
sustituye al anterior y borra el fichero antiguo del bucket.

**DNI, permiso y ficha técnica admiten varias caras.** Un DNI tiene dos y el
domicilio solo está en el reverso, así que el hueco acepta *Anverso* y *Reverso*
por separado —sin que el segundo pise al primero— o un único archivo con las dos.
La fila muestra qué hay (*anverso ✓ · reverso pendiente*) y queda en
**Incompleto** hasta tenerlo todo. Gest-IA lee las caras **juntas**, como un solo
documento; si falta una, avisa de cuál y deja sus campos en blanco.

### 7 · Contrato de compraventa

Genera un documento HTML imprimible pre-rellenado con los datos del expediente:
partes, vehículo, precio, seis cláusulas (cargas, estado, responsabilidades,
plazo de 30 días, comunicación de venta, fuero) y espacios de firma. Se imprime
o se guarda como PDF desde el navegador. Los campos que falten aparecen como
huecos en blanco y se avisa en pantalla de cuáles son.

### 8 · Eliminar un expediente

Un expediente equivocado se borra desde su ficha, y se borra **entero**:
archivos del bucket, filas de `gestotrafic_documentos` y expediente. En ese
orden, que no es cosmético.

> La política del bucket autoriza el borrado comprobando que **el expediente
> existe**. Borrarlo primero hace dos cosas a la vez: la FK en cascada se lleva
> las filas de documentos —y con ellas el registro de qué archivo era cuál— y la
> política deja de autorizar nada sobre esa carpeta. Los ficheros se quedan ahí,
> **huérfanos y sin llave**. Por eso los objetos van primero, y si su borrado
> falla el proceso se para: mejor un expediente entero que se puede reintentar
> que medio expediente que ya no se puede arreglar.

Va por Edge Function (`gestotrafic-borrar-expediente`) porque el orden importa y
el navegador no puede garantizarlo: si se le corta la conexión a mitad, deja el
expediente a medio borrar.

**Quién puede**: el admin, cualquiera; un gestor, los suyos. Mismo criterio que
el RLS, comprobado otra vez en la función porque usa el `service_role` y el RLS
no la frena — un gestor que llame a la función a mano recibe un 403.

El diálogo de confirmación **dice qué se lleva por delante**: referencia,
matrícula, cliente y el desglose de documentos y archivos (el DNI aparece con sus
dos caras). No hay papelera y el diálogo lo dice.

### 9 · Expediente completo para el Colegio

Un botón en la pestaña *Documentación* reúne **toda** la documentación en un solo
documento y lo devuelve en **dos formatos**:

| | Para qué | Cómo |
|---|---|---|
| **HTML** | el acceso de expedientes del Colegio | **autocontenido**: imágenes en base64 y PDF incrustados. Un archivo que se abre solo, sin depender de nada externo |
| **PDF** | archivo y envío | mismo contenido y orden. Cada imagen es una página; los PDF aportados se anexan **página a página** con `pdf-lib`, conservando su texto |

Cada botón genera **su** formato: la función construye solo el que se le pide.

El orden es el del catálogo del trámite, que es el del expediente: portada con
los datos y el índice, identidad del comprador, identidad del vendedor, permiso,
ficha técnica, contrato o factura, mandato y lo demás.

> ⚠️ **Pendiente del formato real del Colegio.** Esta es la primera versión: un
> HTML limpio y autocontenido. Si el Colegio publica una estructura concreta
> —es un formato de interoperabilidad, tiene que casar con lo que lee su
> plataforma—, hay que replicarla. Se cambia en un solo sitio,
> `construirHTML()` de `gestotrafic-expediente`.

**Lo que falta consta como pendiente.** Un documento no aportado no genera página
en blanco ni hueco disimulado: sale en el índice marcado *PENDIENTE*, y la
portada dice con cuántos documentos se presenta el expediente. Antes de generar,
la pantalla avisa de lo que falta, pero **no bloquea**: hay expedientes que se
presentan incompletos a propósito.

Se genera **en el servidor** (`gestotrafic-expediente`): los documentos viven en
un bucket privado y se leen con el `service_role`, previa comprobación de que el
expediente es de quien lo pide —el mismo criterio que el RLS—.

**El archivo baja en el cuerpo de la respuesta**, con su `Content-Disposition`, y
el resumen de lo que lleva dentro viaja en la cabecera `X-Expediente-Resumen`.
Eso significa que **sin marcar *guardar copia* no se escribe nada en el bucket**.

> La primera versión entregaba el documento por enlace firmado, y un enlace
> necesita que el objeto exista: cada generación descartada dejaba un fichero sin
> ninguna fila que lo reclamara. Peor aún, borrado el expediente la política de
> Storage ya no permitía borrarlo — huérfano y sin llave. Los huérfanos no se
> limpian: **no llegan a existir**.

Marcando *guardar copia* sí se archiva: se sube el objeto **y** se registra su
fila, en ese orden y con retirada del objeto si la fila falla. Aparece en
*Copias generadas* del checklist y se recupera con un enlace firmado de 1 hora.

El **Colegio** sale de `GT_COLEGIOS` en `config.js`, por la provincia de la
gestoría. Solo lleva el nombre oficial: ni direcciones ni códigos inventados. Y
una provincia sin entrada **no se rellena a ojo** — la portada dice *pendiente de
configurar* y se ve.

---

## Arquitectura

```
index.html                          Login
app.html                            Panel (SPA con router por hash)
assets/css/app.css                  Sistema de diseño WhiteMoon
assets/js/config.js                 Configuración y catálogos (CCAA, estados)
assets/js/auth.js                   Sesión (login contra gestotrafic-auth)
assets/js/tramites.js               Catálogo de trámites
assets/js/api.js                    Capa de datos Supabase
assets/js/contrato.js               Generador del contrato
assets/js/app.js                    Router y vistas
supabase/functions/gestotrafic-auth       Login y alta de gestores (bcrypt)
supabase/functions/gestotrafic-expediente Expediente completo (HTML + PDF)
supabase/functions/gestotrafic-borrar-expediente  Borrado limpio de un expediente
```

El orden de carga importa: `config.js` → `auth.js` → `api.js`. `api.js` necesita
la sesión que guarda `auth.js` para autenticar el cliente de Supabase **antes**
de la primera consulta; si saliera como `anon`, el RLS la devolvería vacía.

Sin frameworks ni build: HTML, CSS y JavaScript puro sobre GitHub Pages.

### Rutas

`#/dashboard` · `#/clientes` · `#/clientes/:id` · `#/expedientes` ·
`#/expedientes/nuevo` · `#/expedientes/:id` · `#/kanban` ·
`#/gest-ia` · `#/gestores` (solo admin)

### Gest-IA

Alta de expedientes subiendo los documentos: Claude los lee con visión, extrae
los campos con un nivel de confianza y monta el expediente pre-rellenado **con el
ITP ya calculado**. Los tres datos que antes ponía el gestor —**tipo de
vehículo**, **CCAA** y **valor base**— los propone también: el tipo sale de la
clasificación de la ficha técnica y la CCAA de la provincia del domicilio del
comprador, que está en el reverso de su DNI.

Queda en **pendiente de validación** hasta que un gestor lo confirma; lo que la
IA no leyó con claridad queda vacío y resaltado, nunca inventado, y si falta
alguna pieza del ITP **no se calcula a medias**: se dice cuál falta. Detalle en
[`GEST-IA.md`](GEST-IA.md).

---

## Aislamiento de datos

Todo vive en tablas **namespaced** creadas para esta demo:

- `gestotrafic_clientes`
- `gestotrafic_expedientes`
- `gestotrafic_documentos`
- Bucket `gestotrafic-docs`
- Edge Function `gestotrafic-itp`
- Secuencia `gestotrafic_exp_seq`

Garantías:

- **Sin claves foráneas** hacia `onboarding_clientes` ni hacia ninguna tabla del
  sistema real. Las únicas FK son entre tablas `gestotrafic_*`.
- **Sin triggers.** La referencia del expediente usa un `DEFAULT` con secuencia;
  `updated_at` lo escribe el cliente.
- No se toca `rag_documentos`, `rag_archivos`, `check_client_health` ni ninguna
  función existente.
- Las políticas de Storage están acotadas por `bucket_id = 'gestotrafic-docs'`,
  por lo que no afectan a otros buckets.

### RLS

Con el multiusuario, el acceso anónimo está **cerrado**. Las políticas exigen
sesión y aplican el rol:

- `gestotrafic_expedientes` · el gestor solo ve los suyos (`gestor_id =
  auth.uid()`), el admin todos
- `gestotrafic_documentos` · heredan la visibilidad de su expediente
- `gestotrafic_usuarios` · cada uno ve su ficha, el admin todas; el
  `password_hash` no tiene privilegio de lectura para nadie
- `gestotrafic_clientes` · agenda compartida entre gestores, pero solo con sesión
- Bucket `gestotrafic-docs` · **privado**, con enlaces firmados que caducan y
  política de propiedad por expediente

Ver [`USUARIOS.md`](USUARIOS.md).

---

## Datos de demostración

La demo se entrega poblada para que se vea funcionando de entrada:

- **6 clientes** · 4 particulares y 2 empresas (concesionarios), que son las que
  alimentan el selector de *vendedor empresa*
- **12 expedientes** repartidos por los 7 tipos de trámite y por los 5 estados
  del Kanban, y **entre los gestores**
- **2 transferencias con vendedor empresa**, con factura y la **exención de ITP**
  marcada, junto a una transferencia entre particulares con el ITP calculado
- **23 documentos** reales en el bucket, incluido el certificado del CAT de la
  baja definitiva por destrucción

Todos los datos son **ficticios**: ni personas ni DNI reales. Los NIF y CIF
respetan el formato pero están inventados. Los importes de ITP salen del motor
real `gestotrafic-itp`.

---

Hecho por **WhiteMoon Agencia IA** · Majadahonda, Madrid · whitemoon.es
