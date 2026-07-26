# Anexo I del BOE · precios medios de turismos

Origen del valor base automático de los turismos y todo terreno.

| Fichero | Qué es |
|---|---|
| `parse_anexo1.py` | Parser del XML del BOE → TSV. No inventa: aborta con código 1 ante cualquier anomalía |
| `anexo1-turismos-2026.tsv` | 61.634 filas de turismos y todo terreno (Orden HAC/1501/2025) |
| `anexo1-autocaravanas-2026.tsv` | 9.252 filas de autocaravanas (misma Orden) |
| `precios-medios-2026.xml` | El XML original, **no versionado** (42 MB). Se rebaja con el `curl` de abajo |

## Estructura del Anexo I

El XML del BOE trae las tablas como `<table>` con celdas reales — **no son
imágenes**, no hace falta OCR. Son 204 tablas en total y las secciones van en
este orden:

| Tablas | Sección |
|---|---|
| 0–111 | **Turismos y todo terreno**, una tabla por marca (`Marca: ABARTH` … `Marca: ZHIDOU`) |
| 112–188 | Autocaravanas (reinicia el alfabeto: `ACE` … `WINGAMM`) |
| 189–192 | Motos eléctricas, motos de combustión, quads y buggys (por tramo) |
| 193–200 | Anexo II y III · embarcaciones y motores marinos |
| 201–203 | Depreciación: embarcaciones, Anexo IV general y Anexo IV autocaravanas |

Cada fila de turismo tiene exactamente 10 celdas:

```
Modelo-Tipo | Inicio | Fin | C.C. | N.º cilind. | Tipo motor | P kW | cvf | cv | 2026 Valor euros
```

`Tipo motor` usa la leyenda del propio anexo: `G` gasolina, `D` diésel, `M`
etanol/bio, `S` GLP, `Elc` eléctrico, `H` hidrógeno, `PHEV` híbrido enchufable
y `GyE`/`DyE`/`SyE` híbridos no enchufables.

> **Turismos y autocaravanas se cargan por separado** —con `tipo_vehiculo`
> distinto— porque el Anexo IV les aplica tablas de depreciación diferentes: la
> 202 (13 tramos) y la 203 (19 tramos, hasta «más de 18 años»). Comparten
> estructura de columnas, pero mezclarlas daría cuotas incorrectas.

En la sección de autocaravanas el BOE escribe `d` en minúscula en una fila (la
`VW California 1.9D.`). Como ningún código de la leyenda difiere de otro solo
por la caja, el parser lo reconoce sin distinguirla y lo deja anotado en el
informe. No es una anomalía: el código sigue siendo el del BOE.

## Recarga anual

Cada diciembre se publica una Orden HAC nueva. El identificador BOE cambia:
búscalo en boe.es (`Orden HAC/.../AÑO ... precios medios de venta`).

```bash
# 1. Descargar el XML de la Orden nueva
curl -L -o data/boe/precios-medios-AAAA.xml \
  "https://www.boe.es/diario_boe/xml.php?id=BOE-A-AAAA-NNNNN"

# 2. Parsear las dos secciones. Si sus límites han cambiado, el parser avisa
#    ("la tabla no declara una marca") y hay que ajustar SECCIONES.
python data/boe/parse_anexo1.py data/boe/precios-medios-AAAA.xml \
       turismo      data/boe/anexo1-turismos-AAAA.tsv
python data/boe/parse_anexo1.py data/boe/precios-medios-AAAA.xml \
       autocaravana data/boe/anexo1-autocaravanas-AAAA.tsv
# Los dos deben terminar con "Sin anomalías." y código 0. Si no, NO cargues.

# 3. Cargar (ver el SQL en ../../supabase/migrations/README.md) con el
#    orden_boe de la Orden nueva. Las filas viejas se quedan: un expediente
#    abierto puede estar calculado con la anterior.

# 4. Comprobar que la depreciación del Anexo IV no ha cambiado (tablas 202 y
#    203 del XML). Si cambia, se actualiza PRIMERO calculadora-itp y luego se
#    porta a gestotrafic-itp.
node tools/verificar-itp.js
```

Tras cargar hay que apuntar `gestotrafic_orden_vigente()` a la Orden nueva: las
búsquedas filtran por ella, así que **cargar no basta para activarla**.
