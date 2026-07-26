# Anexo I del BOE · precios medios de turismos

Origen del valor base automático de los turismos y todo terreno.

| Fichero | Qué es |
|---|---|
| `parse_anexo1.py` | Parser del XML del BOE → TSV. No inventa: aborta con código 1 ante cualquier anomalía |
| `anexo1-turismos-2026.tsv` | Las 61.634 filas cargadas en `gestotrafic_precios_medios` (Orden HAC/1501/2025) |
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

> **Las autocaravanas no se cargan.** Tienen su propia tabla de depreciación en
> el Anexo IV (la tabla 203, distinta de la 202 que usa el motor), así que
> cargarlas sin implementar esa segunda tabla daría un ITP incorrecto.

## Recarga anual

Cada diciembre se publica una Orden HAC nueva. El identificador BOE cambia:
búscalo en boe.es (`Orden HAC/.../AÑO ... precios medios de venta`).

```bash
# 1. Descargar el XML de la Orden nueva
curl -L -o data/boe/precios-medios-AAAA.xml \
  "https://www.boe.es/diario_boe/xml.php?id=BOE-A-AAAA-NNNNN"

# 2. Comprobar que los límites de sección siguen siendo los mismos.
#    Si la sección de turismos ya no acaba en la tabla 111, el parser avisa
#    ("la tabla no declara una marca"): hay que ajustar ULTIMA_TABLA_TURISMO.
python data/boe/parse_anexo1.py data/boe/precios-medios-AAAA.xml \
       data/boe/anexo1-turismos-AAAA.tsv
# Debe terminar con "Sin anomalías." y código 0. Si no, NO cargues.

# 3. Cargar (ver el SQL en ../../supabase/migrations/README.md) con el
#    orden_boe de la Orden nueva. Las filas viejas se quedan: un expediente
#    abierto puede estar calculado con la anterior.
```

Tras cargar, **el filtro por `orden_boe` de las funciones de búsqueda deja de
ser opcional**: con dos Órdenes en la tabla, una búsqueda sin filtrar devuelve
filas de las dos y el resultado depende del orden del índice.
