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
| 1 | Login multirol (gestor / admin) | ✅ |
| 2 | Dashboard con KPIs | ✅ |
| 3 | Fichas de clientes (particular / empresa) + historial | ✅ |
| 4 | Expedientes de transferencia + Kanban drag & drop | ✅ |
| 5 | Calculadora ITP integrada (BOE 2026) | ✅ |
| 6 | Captura de documentación + checklist | ✅ |
| 7 | Contrato de compraventa pre-rellenado | ✅ |

### 1 · Login multirol

Credenciales de demostración:

| Usuario | Contraseña | Rol | Ve además |
|---------|-----------|-----|-----------|
| `gestor` | `demo` | Gestor | — |
| `admin`  | `demo` | Administrador | Botones de eliminar cliente y expediente |

> ⚠️ **No es autenticación real.** Se resuelve en el navegador
> (`assets/js/auth.js`) para poder enseñar los dos roles. En un despliegue de
> producción se sustituye por Supabase Auth con contraseñas hasheadas en
> servidor. La sesión vive en `sessionStorage` y se pierde al cerrar la pestaña.

### 2 · Dashboard

KPIs ligeros: expedientes activos, expedientes del mes, clientes totales e
impuestos calculados en el mes. Barras de expedientes por estado y tabla de los
últimos expedientes.

### 3 · Clientes

Alta de **particular** (nombre, apellidos, NIF) o **empresa** (razón social, CIF),
con contacto, dirección y notas. La ficha muestra el historial completo de
trámites del cliente.

### 4 · Expedientes y Kanban

Trámite estrella: **transferencia de vehículo**. Datos del vehículo (marca,
modelo, matrícula, fecha de matriculación, combustible, cilindrada, CVf, etiqueta
DGT), datos de vendedor y comprador, y fiscalidad.

> Desde la ampliación de trámites hay **7 tipos** (matriculación, notificación de
> venta, bajas y duplicados). Cada uno declara sus campos y su checklist en el
> catálogo: ver [`TRAMITES.md`](TRAMITES.md).

Referencia automática `EXP-AAAA-NNNN` mediante secuencia de Postgres (sin
triggers).

Estados en tablero Kanban con drag & drop nativo HTML5:

```
nuevo → documentación pendiente → en tramitación → presentado → completado
```

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

### 6 · Documentación

Checklist por trámite con 5 documentos obligatorios (DNI comprador, DNI vendedor,
permiso de circulación, ficha técnica, contrato) y 2 opcionales (ITV, otros).
Cada documento tiene estado *pendiente* / *recibido*, barra de progreso, y se
sube (foto o escaneo, JPG/PNG/PDF, máx. 10 MB) al bucket aislado
`gestotrafic-docs` de Supabase Storage. Subir un documento del mismo tipo
sustituye al anterior y borra el fichero antiguo del bucket.

### 7 · Contrato de compraventa

Genera un documento HTML imprimible pre-rellenado con los datos del expediente:
partes, vehículo, precio, seis cláusulas (cargas, estado, responsabilidades,
plazo de 30 días, comunicación de venta, fuero) y espacios de firma. Se imprime
o se guarda como PDF desde el navegador. Los campos que falten aparecen como
huecos en blanco y se avisa en pantalla de cuáles son.

---

## Arquitectura

```
index.html              Login
app.html                Panel (SPA con router por hash)
assets/css/app.css      Sistema de diseño WhiteMoon
assets/js/auth.js       Sesión de demo y roles
assets/js/config.js     Configuración y catálogos (CCAA, estados, checklist)
assets/js/api.js        Capa de datos Supabase
assets/js/contrato.js   Generador del contrato
assets/js/app.js        Router y vistas
```

Sin frameworks ni build: HTML, CSS y JavaScript puro sobre GitHub Pages.

### Rutas

`#/dashboard` · `#/clientes` · `#/clientes/:id` · `#/expedientes` ·
`#/expedientes/nuevo` · `#/expedientes/:id` · `#/kanban`

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

Las tres tablas tienen RLS activado con una política permisiva para `anon` y
`authenticated`, acotada a las propias tablas de la demo. Es deliberado: la demo
es pública y no contiene datos reales de clientes. Para un despliegue real se
sustituye por políticas por `tenant_id` con Supabase Auth.

---

## Datos de demostración

La demo se entrega con 4 clientes y 5 expedientes repartidos por los distintos
estados del Kanban, todos con el ITP calculado con el motor real.

---

Hecho por **WhiteMoon Agencia IA** · Majadahonda, Madrid · whitemoon.es
