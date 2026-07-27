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

### 8 · Expediente completo para el Colegio

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
los campos con un nivel de confianza y monta el expediente pre-rellenado con el
ITP calculado. Queda en **pendiente de validación** hasta que un gestor lo
confirma; lo que la IA no leyó con claridad queda vacío y resaltado, nunca
inventado. Detalle en [`GEST-IA.md`](GEST-IA.md).

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
