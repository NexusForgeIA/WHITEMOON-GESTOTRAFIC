import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * gestotrafic-itp
 * -----------------------------------------------------------
 * Motor de cálculo ITP + tasa DGT + valor venal para el CRM
 * GestoTrafic (demo WhiteMoon).
 *
 * FUENTE: motor de producción de whitemoon.es/calculadora-itp/
 * (BOE 2026 · Orden HAC/1501/2025). Tablas y reglas reutilizadas
 * VERBATIM: tabla de depreciación Anexo IV, tipos autonómicos,
 * cuotas fijas, exenciones, etiqueta DGT 0/ECO y >15 CVf.
 * No se reinventa el cálculo: sólo se envuelve en un contrato
 * de entrada/salida JSON para el CRM.
 *
 * VALOR BASE (Anexo I)
 * Se puede pasar `valor_boe` a mano, como siempre, o dejar que el
 * motor lo busque en `gestotrafic_precios_medios`. La búsqueda NO
 * inventa: si no hay fila que encaje devuelve `sin_valor_boe` y el
 * llamante pide el dato al gestor. La lógica fiscal no cambia:
 * sólo se alimenta el valor base.
 *
 * En turismos el llamante puede fijar la fila exacta del Anexo I con
 * `valor_base_id`: es la versión que el gestor ha visto y confirmado
 * en el buscador. Sin ella se busca por marca/modelo/versión, y si
 * salen varias candidatas NO se elige ninguna.
 *
 * Tasa DGT 4.1 (cambio de titularidad): 55,70 € — misma cifra
 * usada en whitemoon.es/calculadora-transferencia-vehiculo/.
 */

const TASA_DGT_TRANSFERENCIA = 55.70;

// --- Anexo IV BOE: depreciación turismos/motos/quads ---
const tablaTurismos: [number, number, string][] = [
  [0, 1.00, "Hasta 1 año"], [1, 0.84, "Más de 1 año, hasta 2"],
  [2, 0.67, "Más de 2 años, hasta 3"], [3, 0.56, "Más de 3 años, hasta 4"],
  [4, 0.47, "Más de 4 años, hasta 5"], [5, 0.39, "Más de 5 años, hasta 6"],
  [6, 0.34, "Más de 6 años, hasta 7"], [7, 0.28, "Más de 7 años, hasta 8"],
  [8, 0.24, "Más de 8 años, hasta 9"], [9, 0.19, "Más de 9 años, hasta 10"],
  [10, 0.17, "Más de 10 años, hasta 11"], [11, 0.13, "Más de 11 años, hasta 12"],
  [12, 0.10, "Más de 12 años"]
];

// --- Parámetros autonómicos ---
// tg=tipo general · t15=tipo >15 CVf · t0=etiqueta 0 · teco=etiqueta ECO
// exA/exV=exención por antigüedad/valor · cA=antigüedad mín. cuota fija · cf=tramos cuota fija
type Ccaa = {
  tg: number; t15: number; t0: number; teco: number;
  exA: number; exV: number; cA: number; cf: [number, number][] | null;
};

const ccaaData: Record<string, Ccaa> = {
  "Andalucía":            { tg: 0.04,  t15: 0.08, t0: 0.01, teco: -1,   exA: 0,  exV: 0,     cA: 0,  cf: null },
  "Aragón":               { tg: 0.04,  t15: -1,   t0: -1,   teco: -1,   exA: 0,  exV: 0,     cA: 10, cf: [[1000,0],[1500,20],[2000,30],[Infinity,30]] },
  "Asturias":             { tg: 0.04,  t15: 0.08, t0: -1,   teco: -1,   exA: 0,  exV: 0,     cA: 0,  cf: null },
  "Baleares":             { tg: 0.04,  t15: 0.08, t0: 0,    teco: 0.02, exA: 0,  exV: 0,     cA: 0,  cf: null },
  "Canarias (IGIC)":      { tg: 0.055, t15: -1,   t0: -1,   teco: -1,   exA: 0,  exV: 0,     cA: 10, cf: [[1000,40],[1500,70],[2000,115],[Infinity,115]] },
  "Cantabria":            { tg: 0.06,  t15: -1,   t0: -1,   teco: -1,   exA: 0,  exV: 0,     cA: 10, cf: [[999,45],[1499,60],[1999,90],[Infinity,90]] },
  "Castilla-La Mancha":   { tg: 0.06,  t15: -1,   t0: -1,   teco: -1,   exA: 0,  exV: 0,     cA: 0,  cf: null },
  "Castilla y León":      { tg: 0.05,  t15: 0.08, t0: -1,   teco: -1,   exA: 0,  exV: 0,     cA: 0,  cf: null },
  "Cataluña":             { tg: 0.05,  t15: -1,   t0: 0,    teco: -1,   exA: 10, exV: 40000, cA: 0,  cf: null },
  "Ceuta":                { tg: 0.04,  t15: -1,   t0: -1,   teco: -1,   exA: 0,  exV: 0,     cA: 0,  cf: null },
  "Comunidad de Madrid":  { tg: 0.04,  t15: -1,   t0: -1,   teco: -1,   exA: 0,  exV: 0,     cA: 0,  cf: null },
  "Comunidad Valenciana": { tg: 0.06,  t15: -1,   t0: -1,   teco: -1,   exA: 0,  exV: 0,     cA: 0,  cf: null },
  "Extremadura":          { tg: 0.06,  t15: -1,   t0: -1,   teco: -1,   exA: 0,  exV: 0,     cA: 0,  cf: null },
  "Galicia":              { tg: 0.03,  t15: -1,   t0: 0,    teco: -1,   exA: 0,  exV: 0,     cA: 14, cf: [[1199,22],[1599,38],[Infinity,38]] },
  "La Rioja":             { tg: 0.04,  t15: -1,   t0: -1,   teco: -1,   exA: 0,  exV: 0,     cA: 0,  cf: null },
  "Melilla":              { tg: 0.04,  t15: -1,   t0: -1,   teco: -1,   exA: 0,  exV: 0,     cA: 0,  cf: null },
  "Murcia":               { tg: 0.04,  t15: -1,   t0: -1,   teco: -1,   exA: 0,  exV: 0,     cA: 12, cf: [[1000,0],[1500,30],[2000,50],[Infinity,75]] },
  "Navarra":              { tg: 0.04,  t15: -1,   t0: -1,   teco: -1,   exA: 10, exV: 40000, cA: 0,  cf: null },
  "País Vasco":           { tg: 0.04,  t15: -1,   t0: -1,   teco: -1,   exA: 0,  exV: 0,     cA: 0,  cf: null }
};

// Cuotas fijas Comunitat Valenciana
const valencianaCuotas = {
  motos:  { ">12": [[250,10],[550,20],[750,35],[Infinity,55]],
            "5-12": [[250,30],[550,60],[750,90],[Infinity,140]] },
  coches: { ">12": [[1500,40],[2000,60],[Infinity,140]],
            "5-12": [[1500,120],[2000,180],[Infinity,280]] }
} as Record<string, Record<string, [number, number][]>>;

function aniosUso(fechaMat: string, fechaTrans: string): number | null {
  if (!fechaMat || !fechaTrans) return null;
  const mat = new Date(fechaMat), trans = new Date(fechaTrans);
  if (isNaN(+mat) || isNaN(+trans) || trans < mat) return null;
  let anos = trans.getFullYear() - mat.getFullYear();
  const m = trans.getMonth() - mat.getMonth();
  if (m < 0 || (m === 0 && trans.getDate() < mat.getDate())) anos--;
  return anos;
}

function tramoTexto(anos: number | null): string {
  if (anos === null) return "—";
  if (anos < 1) return "Hasta 1 año";
  if (anos >= 12) return "Más de 12 años";
  return `Más de ${anos} años, hasta ${anos + 1}`;
}

function cuotaFijaValenciana(anos: number, cilindrada: number, valor: number, esMoto: boolean) {
  if (valor >= 20000) return null;
  if (anos == null || !cilindrada) return null;
  let tramoAnt: string;
  if (anos > 12) tramoAnt = ">12";
  else if (anos > 5 && anos <= 12) tramoAnt = "5-12";
  else return null;
  const tabla = esMoto ? valencianaCuotas.motos[tramoAnt] : valencianaCuotas.coches[tramoAnt];
  for (const [maxCc, cuota] of tabla) if (cilindrada <= maxCc) return { cuota, tramoAnt, esMoto };
  return null;
}

function cuotaFijaEstandar(p: Ccaa, anos: number | null, cilindrada: number) {
  if (!p.cf || !cilindrada) return null;
  if (p.cA === 0 || anos === null || anos < p.cA) return null;
  for (const [maxCc, cuota] of p.cf) if (cilindrada <= maxCc) return cuota;
  return null;
}

function calcularTipoNormal(p: Ccaa, etiqueta: string, cvf: number, base: number) {
  let tipo = p.tg;
  if (etiqueta === "0" && p.t0 >= 0) tipo = p.t0;
  else if (etiqueta === "ECO" && p.teco >= 0) tipo = p.teco;
  else if (cvf > 15 && p.t15 >= 0) tipo = p.t15;
  return { tipo, itp: base * tipo };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------
   Valor base automático desde gestotrafic_precios_medios.
   Devuelve null cuando no hay match: el motor NUNCA estima un valor.
   ------------------------------------------------------------------ */
type Origen = {
  origen: "manual" | "tabla_boe";
  fila?: Record<string, unknown>;
  candidatos?: Record<string, unknown>[];
};

async function buscarValorBase(input: Record<string, unknown>): Promise<{ valor: number | null; meta: Origen | null }> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return { valor: null, meta: null };

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const tipo = String(input.tipo_vehiculo ?? "coche");

  // Turismos: por la fila exacta que haya fijado el gestor, o si no por
  // marca / modelo / versión.
  if (tipo === "coche" || tipo === "turismo") {
    const filaId = input.valor_base_id ? String(input.valor_base_id) : null;
    if (!filaId && (!input.marca || !input.modelo)) return { valor: null, meta: null };
    const { data, error } = await sb.rpc("gestotrafic_buscar_valor_base", {
      p_marca: input.marca ? String(input.marca) : null,
      p_modelo: input.modelo ? String(input.modelo) : null,
      p_version: input.version ? String(input.version) : null,
      p_fecha_matriculacion: input.fecha_matriculacion ? String(input.fecha_matriculacion) : null,
      p_id: filaId
    });
    if (error || !Array.isArray(data) || !data.length) return { valor: null, meta: null };

    const filas = data.filter((f: Record<string, unknown>) => f.id !== null);
    if (!filas.length) return { valor: null, meta: null };
    // Varios candidatos = ambigüedad. Se devuelven todos y NO se elige:
    // dos versiones del mismo modelo pueden tener precios muy distintos.
    if (filas.length > 1) return { valor: null, meta: { origen: "tabla_boe", candidatos: filas } };
    return { valor: Number(filas[0].valor_base), meta: { origen: "tabla_boe", fila: filas[0] } };
  }

  // Motos, quads y buggys: por tramo de cilindrada o de kW.
  const tipoTramo = tipo === "moto" && Number(input.potencia_kw) > 0 ? "moto_electrica" : tipo;
  const { data, error } = await sb.rpc("gestotrafic_buscar_valor_base_tramo", {
    p_tipo_vehiculo: tipoTramo,
    p_cilindrada: input.cilindrada ? Number(input.cilindrada) : null,
    p_potencia_kw: input.potencia_kw ? Number(input.potencia_kw) : null
  });
  if (error || !Array.isArray(data) || !data.length) return { valor: null, meta: null };

  const fila = data[0] as Record<string, unknown>;
  if (!fila.encontrado) return { valor: null, meta: null };
  return { valor: Number(fila.valor_base), meta: { origen: "tabla_boe", fila } };
}

async function calcularItp(input: Record<string, unknown>) {
  let valorBoe         = Number(input.valor_boe) || 0;
  const fechaMat       = String(input.fecha_matriculacion ?? "");
  const fechaTrans     = String(input.fecha_transmision ?? new Date().toISOString().slice(0, 10));
  const ccaaName       = String(input.ccaa ?? "Comunidad de Madrid");
  const cilindrada     = Number(input.cilindrada) || 0;
  const cvf            = Number(input.cvf) || 0;
  const etiqueta       = String(input.etiqueta_dgt ?? "");
  const usoEsp         = input.uso_especial === true;
  const precioContrato = Number(input.precio_contrato) || 0;
  const esMoto         = String(input.tipo_vehiculo ?? "coche") === "moto";

  const p = ccaaData[ccaaName];
  if (!p) return { error: `CCAA no reconocida: ${ccaaName}`, ccaa_validas: Object.keys(ccaaData) };

  const anos = aniosUso(fechaMat, fechaTrans);
  if (anos === null) return { error: "Fecha de matriculación inválida o posterior a la transmisión." };

  // El valor base manual manda. Solo si no viene se busca en la tabla.
  let valorBase: Origen = { origen: "manual" };
  if (!valorBoe) {
    const buscado = await buscarValorBase(input);
    if (buscado.valor) {
      valorBoe = buscado.valor;
      valorBase = buscado.meta ?? { origen: "tabla_boe" };
    } else if (buscado.meta?.candidatos) {
      // Ambigüedad real: hay varias versiones posibles. No se elige.
      return {
        error: "sin_valor_boe",
        motivo: "varias_versiones",
        mensaje: "Hay varias versiones de ese modelo con precios distintos. Elige una o introduce el valor base a mano.",
        candidatos: buscado.meta.candidatos
      };
    }
  }

  if (!valorBoe) {
    // Sin dato y sin match. No se estima: se pide.
    return {
      error: "sin_valor_boe",
      motivo: "sin_match",
      mensaje: "No hay precio medio del Anexo I para ese vehículo. Introduce el valor base a mano."
    };
  }

  const fila = tablaTurismos.find((r) => r[0] === Math.min(anos, 12))!;
  const pctDep = fila[1];
  const coefUso = usoEsp ? 0.7 : 1;

  // Valor venal (valor fiscal) = precio Anexo I × depreciación Anexo IV × coef. uso
  const valorVenal = valorBoe * pctDep * coefUso;

  // Base imponible = el mayor entre valor fiscal y precio de contrato
  let baseImponible = valorVenal;
  let usaContrato = false;
  if (precioContrato > 0 && precioContrato > valorVenal) {
    baseImponible = precioContrato;
    usaContrato = true;
  }

  let itp = 0;
  let tipoAplicable: number | string = p.tg;
  let regimen = "tipo_general";
  let nota = "";

  if (p.exA > 0 && anos >= p.exA && valorBoe < p.exV) {
    itp = 0;
    tipoAplicable = "EXENTO";
    regimen = "exento";
    nota = `Exento en ${ccaaName}: antigüedad ≥${p.exA} años y valor original <${p.exV} €.`;
  } else if (ccaaName === "Comunidad Valenciana") {
    const cf = cuotaFijaValenciana(anos, cilindrada, baseImponible, esMoto);
    if (cf) {
      itp = cf.cuota; tipoAplicable = "Cuota fija"; regimen = "cuota_fija";
      nota = `Cuota fija autonómica (${cf.esMoto ? "moto" : "coche"}, ${cf.tramoAnt} años, ${cilindrada} cc).`;
    } else {
      const r = calcularTipoNormal(p, etiqueta, cvf, baseImponible);
      itp = r.itp; tipoAplicable = r.tipo;
    }
  } else if (p.cA > 0 && anos >= p.cA) {
    const cuota = cuotaFijaEstandar(p, anos, cilindrada);
    if (cuota !== null) {
      itp = cuota; tipoAplicable = "Cuota fija"; regimen = "cuota_fija";
      nota = `Cuota fija autonómica (>${p.cA} años, ${cilindrada} cc).`;
    } else {
      const r = calcularTipoNormal(p, etiqueta, cvf, baseImponible);
      itp = r.itp; tipoAplicable = r.tipo;
    }
  } else {
    const r = calcularTipoNormal(p, etiqueta, cvf, baseImponible);
    itp = r.itp; tipoAplicable = r.tipo;
    if (usaContrato) nota = `Base = precio de contrato (${r2(baseImponible)} €) por ser superior al valor fiscal (${r2(valorVenal)} €).`;
  }

  const tasaDgt = TASA_DGT_TRANSFERENCIA;

  return {
    ok: true,
    valor_venal: r2(valorVenal),
    base_imponible: r2(baseImponible),
    itp: r2(itp),
    tasa_dgt: tasaDgt,
    total_impuestos: r2(itp + tasaDgt),
    detalle: {
      ccaa: ccaaName,
      anios_uso: anos,
      tramo: tramoTexto(anos),
      pct_depreciacion: pctDep,
      valor_boe: valorBoe,
      valor_base_origen: valorBase.origen,
      valor_base_fila: valorBase.fila ?? null,
      coef_uso_especial: coefUso,
      base_desde_contrato: usaContrato,
      tipo_aplicable: tipoAplicable,
      regimen,
      etiqueta_dgt: etiqueta || null,
      cvf: cvf || null,
      cilindrada: cilindrada || null,
      nota,
      concepto_tasa_dgt: "Tasa DGT 4.1 · cambio de titularidad",
      fuente: "BOE 2026 · Orden HAC/1501/2025 (Anexo I precio, Anexo IV depreciación)"
    }
  };
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info"
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  try {
    const body = await req.json();
    const result = await calcularItp(body ?? {});
    return new Response(JSON.stringify(result), {
      status: (result as Record<string, unknown>).error ? 400 : 200,
      headers: { ...CORS, "Content-Type": "application/json" }
    });
  } catch (_err) {
    return new Response(JSON.stringify({ error: "Petición inválida. Se espera un JSON con los datos del vehículo." }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" }
    });
  }
});
