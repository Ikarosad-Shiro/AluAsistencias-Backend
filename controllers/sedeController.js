// controllers/sedeController.js
const Sede = require('../models/Sede');

/* ========= Helpers ========= */
const HHMM = /^\d{2}:\d{2}$/;
const isHHMM = (s) => typeof s === 'string' && HHMM.test(s);
// compara strings "HH:mm" (sirve si NO es overnight)
const timeLt = (a, b) => a < b;

// Normaliza DOW: acepta 0..6 (JS) y 1..7 (humano); 7→0
const normalizeDow = (v) => {
  if (v == null) return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  if (n >= 0 && n <= 6) return n;     // 0..6
  if (n >= 1 && n <= 7) return n % 7; // 1..7 -> 0..6 (7->0)
  return null;
};

/* ========== HORARIO BASE ========== */
exports.getHorarioBase = async (req, res) => {
  try {
    const sede = await Sede.findOne({ id: Number(req.params.sedeId) });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });
    res.json(sede.horarioBase || null);
  } catch (e) {
    console.error('getHorarioBase', e);
    res.status(500).json({ message: 'Error al obtener horario base' });
  }
};

exports.setHorarioBase = async (req, res) => {
  try {
    const sede = await Sede.findOne({ id: Number(req.params.sedeId) });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });

    // Acepta { horarioBase: {...} } o plano { desde, reglas, nuevoIngreso }
    const body = req.body?.horarioBase ? req.body.horarioBase : req.body;
    const { desde, reglas = [], nuevoIngreso } = body || {};

    if (!desde || !Array.isArray(reglas)) {
      return res.status(400).json({ message: 'desde y reglas son obligatorios' });
    }

    const desdeDate = new Date(desde);
    if (Number.isNaN(desdeDate.getTime())) {
      return res.status(400).json({ message: 'desde inválido' });
    }

    // Normalizar reglas base (solo guardamos días con jornadas válidas)
    const mapByDow = new Map();
    for (const r of reglas) {
      const dow = normalizeDow(r.dow);
      if (dow === null) {
        return res.status(400).json({ message: 'dow inválido', detalle: r.dow });
      }

      const jornadasValidas = (r.jornadas || [])
        .filter(j => j && isHHMM(j.ini) && isHHMM(j.fin))
        .map(j => ({ ini: j.ini, fin: j.fin, overnight: !!j.overnight }))
        .filter(j => j.overnight || timeLt(j.ini, j.fin)); // si no es overnight, ini < fin

      if (jornadasValidas.length === 0) continue; // día inactivo ⇒ no guardamos
      mapByDow.set(dow, jornadasValidas);
    }

    const reglasNorm = Array.from(mapByDow.entries())
      .map(([dow, jornadas]) => ({ dow, jornadas }))
      .sort((a, b) => a.dow - b.dow);

    // Normalizar bloque “nuevoIngreso” (opcional)
    let nuevoIngresoNorm = sede.horarioBase?.nuevoIngreso || undefined;
    if (nuevoIngreso) {
      const activo = !!nuevoIngreso.activo;
      let jornadasNI = Array.isArray(nuevoIngreso.jornadas) ? nuevoIngreso.jornadas : [];
      jornadasNI = jornadasNI
        .filter(j => j && isHHMM(j.ini) && isHHMM(j.fin))
        .map(j => ({ ini: j.ini, fin: j.fin, overnight: !!j.overnight }))
        .filter(j => j.overnight || timeLt(j.ini, j.fin));

      nuevoIngresoNorm = {
        activo,
        duracionDias: Number(nuevoIngreso.duracionDias) > 0 ? Number(nuevoIngreso.duracionDias) : 30,
        aplicarSoloDiasActivosBase: nuevoIngreso.aplicarSoloDiasActivosBase !== false, // default true
        jornadas: activo ? jornadasNI : []
      };
    }

    const prevVersion = sede.horarioBase?.meta?.version || 0;
    sede.horarioBase = {
      desde: desdeDate,
      reglas: reglasNorm,
      meta: { version: prevVersion + 1 },
      ...(nuevoIngresoNorm ? { nuevoIngreso: nuevoIngresoNorm } : {})
    };

    await sede.save();
    return res.json(sede.horarioBase);
  } catch (e) {
    console.error('setHorarioBase', e);
    res.status(500).json({ message: 'Error al guardar horario base' });
  }
};

/* ========== RESOLVER HORARIO APLICABLE (temporal: solo base) ========== */
exports.getHorarioAplicable = async (req, res) => {
  try {
    const { sedeId } = req.params;
    const { fecha } = req.query; // "YYYY-MM-DD"
    if (!fecha) return res.status(400).json({ message: 'Query ?fecha=YYYY-MM-DD es obligatoria' });

    const sede = await Sede.findOne({ id: Number(sedeId) });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });

    const dow = new Date(fecha + 'T00:00:00').getDay(); // 0..6 (0=Domingo)
    const base = sede.horarioBase;

    if (!base || !Array.isArray(base.reglas)) {
      return res.json({ origen: 'sin_definir', jornadas: [] });
    }

    const regla = base.reglas.find(r => Number(r.dow) === dow);
    return res.json({ origen: 'horario_base', jornadas: regla ? regla.jornadas : [] });
  } catch (e) {
    console.error('getHorarioAplicable', e);
    res.status(500).json({ message: 'Error al resolver horario aplicable' });
  }
};
