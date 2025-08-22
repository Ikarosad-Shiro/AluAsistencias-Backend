// controllers/sedeController.js
const mongoose = require('mongoose');
const Sede = require('../models/Sede');

const HHMM = /^\d{2}:\d{2}$/;
const isHHMM = (s) => typeof s === 'string' && HHMM.test(s);
const timeLt = (a, b) => a < b;

// Normaliza 1..7 → 0..6 y 0..6 → 0..6
const normalizeDow = (v) => {
  if (v == null) return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  if (n >= 0 && n <= 6) return n;
  if (n >= 1 && n <= 7) return n % 7; // 7 → 0
  return null;
};

/* ================================
   Helpers de normalización/validación
   ================================ */
function normalizeDesde(d) {
  if (!d) return null;
  if (d instanceof Date && !isNaN(d)) return d;
  // 'YYYY-MM-DD' → Date UTC inicio del día
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(d))) return new Date(`${d}T00:00:00.000Z`);
  const dt = new Date(d);
  return isNaN(dt) ? null : dt;
}

/** Acepta 0..6 (0=Dom) o 1..7 (1=Lun..7=Dom). Devuelve 0..6. */
function normalizeDow(x) {
  const n = Number(x);
  if (Number.isNaN(n)) return null;
  if (n >= 0 && n <= 6) return n;       // 0..6
  if (n >= 1 && n <= 7) return n % 7;   // 1..7 → 0..6
  return null;
}

/** Convierte '08:30', '8:30', '08:30 AM', '8:30 pm' → 'HH:mm'. Si ya viene 'HH:mm', lo deja. */
function to24h(s = '') {
  const str = String(s).trim();
  if (!str) return '';
  const m = str.match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
  if (!m) return str; // ya será HH:mm (o algo inválido que validaremos luego)
  let [, hh, mm, ap] = m;
  let h = parseInt(hh, 10);
  if (ap) {
    ap = ap.toUpperCase();
    if (ap === 'AM' && h === 12) h = 0;
    if (ap === 'PM' && h !== 12) h += 12;
  }
  return `${String(h).padStart(2, '0')}:${mm}`;
}

function timeLt(a, b) {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  return ah < bh || (ah === bh && am < bm);
}

/* ================================
   HORARIO BASE
   ================================ */
exports.getHorarioBase = async (req, res) => {
  try {
    const sedeId = Number(req.params.sedeId || req.params.id);
    const sede = await Sede.findOne({ id: sedeId });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });
    return res.json(sede.horarioBase || null);
  } catch (e) {
    console.error('getHorarioBase', e);
    return res.status(500).json({ message: 'Error al obtener horario base' });
  }
};

exports.setHorarioBase = async (req, res) => {
  try {
    const sede = await Sede.findOne({ id: Number(req.params.sedeId) });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });

    // Puede venir { horarioBase: {...} } o plano { desde, reglas, nuevoIngreso }
    const body = req.body?.horarioBase ? req.body.horarioBase : req.body;
    const { desde, reglas = [], nuevoIngreso } = body || {};

    if (!desde || !Array.isArray(reglas)) {
      return res.status(400).json({ message: 'desde y reglas son obligatorios' });
    }

    const desdeDate = new Date(desde);
    if (Number.isNaN(desdeDate.getTime())) {
      return res.status(400).json({ message: 'desde inválido' });
    }

    // ---- Normalizar reglas base (descartar días inactivos/vacíos)
    const mapByDow = new Map();
    for (const r of reglas) {
      const dow = normalizeDow(r.dow);
      if (dow === null) return res.status(400).json({ message: 'dow inválido', detalle: r.dow });

      const jornadasValidas = (r.jornadas || [])
        .filter(j => j && isHHMM(j.ini) && isHHMM(j.fin))
        .map(j => ({
          ini: j.ini,
          fin: j.fin,
          overnight: !!j.overnight
        }))
        .filter(j => j.overnight || timeLt(j.ini, j.fin)); // si no es overnight, ini < fin

      if (jornadasValidas.length === 0) continue; // inactivo ⇒ no guardamos

      mapByDow.set(dow, jornadasValidas);
    }
    const reglasNorm = Array.from(mapByDow.entries())
      .map(([dow, jornadas]) => ({ dow, jornadas }))
      .sort((a, b) => a.dow - b.dow);

    // ---- Normalizar bloque “nuevoIngreso” (opcional)
    let nuevoIngresoNorm = sede.horarioBase?.nuevoIngreso || undefined;
    if (nuevoIngreso) {
      const activo = !!nuevoIngreso.activo;
      let jornadasNI = Array.isArray(nuevoIngreso.jornadas) ? nuevoIngreso.jornadas : [];
      jornadasNI = jornadasNI
        .filter(j => j && isHHMM(j.ini) && isHHMM(j.fin))
        .map(j => ({
          ini: j.ini,
          fin: j.fin,
          overnight: !!j.overnight
        }))
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

/* ================================
   EXCEPCIONES POR DÍA
   ================================ */
exports.listExcepciones = async (req, res) => {
  try {
    const sedeId = Number(req.params.sedeId || req.params.id);
    const sede = await Sede.findOne({ id: sedeId }, { excepciones: 1, _id: 0 });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });

    const items = [...sede.excepciones].sort((a, b) => {
      if (a.fecha === b.fecha) return new Date(b.createdAt) - new Date(a.createdAt);
      return a.fecha < b.fecha ? 1 : -1; // más recientes primero
    });
    return res.json(items);
  } catch (e) {
    console.error('listExcepciones', e);
    return res.status(500).json({ message: 'Error al listar excepciones' });
  }
};

exports.createExcepcion = async (req, res) => {
  try {
    const sedeId = Number(req.params.sedeId || req.params.id);
    const sede = await Sede.findOne({ id: sedeId });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });

    const { fecha, tipo, descripcion = '', horaEntrada = '', horaSalida = '' } = req.body || {};
    if (!fecha || !tipo) return res.status(400).json({ message: 'fecha y tipo son obligatorios' });

    const nueva = {
      _id: new mongoose.Types.ObjectId(),
      fecha,
      tipo,
      descripcion,
      horaEntrada,
      horaSalida
    };

    sede.excepciones.unshift(nueva);
    await sede.save();
    return res.status(201).json(nueva);
  } catch (e) {
    console.error('createExcepcion', e);
    return res.status(500).json({ message: 'Error al crear excepción' });
  }
};

exports.deleteExcepcion = async (req, res) => {
  try {
    const sedeId = Number(req.params.sedeId || req.params.id);
    const sede = await Sede.findOne({ id: sedeId });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });

    const before = sede.excepciones.length;
    sede.excepciones = sede.excepciones.filter(e => String(e._id) !== String(req.params.excepcionId));
    if (sede.excepciones.length === before) {
      return res.status(404).json({ message: 'Excepción no encontrada' });
    }

    await sede.save();
    return res.json({ ok: true });
  } catch (e) {
    console.error('deleteExcepcion', e);
    return res.status(500).json({ message: 'Error al eliminar excepción' });
  }
};

/* ================================
   EXCEPCIONES POR RANGO
   ================================ */
exports.listExcepcionesRango = async (req, res) => {
  try {
    const sedeId = Number(req.params.sedeId || req.params.id);
    const sede = await Sede.findOne({ id: sedeId }, { excepcionesRango: 1, _id: 0 });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });

    const items = [...sede.excepcionesRango].sort((a, b) => (a.desde < b.desde ? -1 : 1));
    return res.json(items);
  } catch (e) {
    console.error('listExcepcionesRango', e);
    return res.status(500).json({ message: 'Error al listar excepciones por rango' });
  }
};

exports.createExcepcionRango = async (req, res) => {
  try {
    const sedeId = Number(req.params.sedeId || req.params.id);
    const sede = await Sede.findOne({ id: sedeId });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });

    const { desde, hasta, dows = [], jornadas = [], descripcion = '' } = req.body || {};
    if (!desde || !hasta || !Array.isArray(jornadas) || jornadas.length === 0) {
      return res.status(400).json({ message: 'desde, hasta y jornadas son obligatorios' });
    }

    const jornadasNorm = jornadas.map(j => ({
      ini: to24h(j.ini),
      fin: to24h(j.fin),
      overnight: !!j.overnight
    }));

    for (const j of jornadasNorm) {
      if (!/^\d{2}:\d{2}$/.test(j.ini) || !/^\d{2}:\d{2}$/.test(j.fin)) {
        return res.status(400).json({ message: 'Hora inválida en jornadas. Usa HH:mm o hh:mm AM/PM', detalle: j });
      }
      if (!j.overnight && !timeLt(j.ini, j.fin)) {
        return res.status(400).json({ message: '"ini" debe ser menor que "fin" cuando overnight=false', detalle: j });
      }
    }

    const dowsNorm = Array.isArray(dows) && dows.length
      ? dows.map(normalizeDow).filter(v => v !== null)
      : []; // vacío => aplica a todos los días del rango

    const nueva = { desde, hasta, dows: dowsNorm, jornadas: jornadasNorm, descripcion };
    sede.excepcionesRango.push(nueva);
    await sede.save();
    return res.status(201).json(nueva);
  } catch (e) {
    console.error('createExcepcionRango', e);
    return res.status(500).json({ message: 'Error al crear excepción por rango' });
  }
};

exports.deleteExcepcionRango = async (req, res) => {
  try {
    const sedeId = Number(req.params.sedeId || req.params.id);
    const sede = await Sede.findOne({ id: sedeId });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });

    const before = sede.excepcionesRango.length;
    sede.excepcionesRango = sede.excepcionesRango.filter(e => String(e._id) !== String(req.params.rangoId));
    if (sede.excepcionesRango.length === before) {
      return res.status(404).json({ message: 'Excepción de rango no encontrada' });
    }

    await sede.save();
    return res.json({ ok: true });
  } catch (e) {
    console.error('deleteExcepcionRango', e);
    return res.status(500).json({ message: 'Error al eliminar excepción por rango' });
  }
};

/* ================================
   RESOLVER HORARIO APLICABLE EN UNA FECHA
   ================================ */
exports.getHorarioAplicable = async (req, res) => {
  try {
    const sedeId = Number(req.params.sedeId || req.params.id);
    const { fecha } = req.query; // "YYYY-MM-DD"
    if (!fecha) return res.status(400).json({ message: 'Query ?fecha=YYYY-MM-DD es obligatoria' });

    const sede = await Sede.findOne({ id: sedeId });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });

    const dow = new Date(`${fecha}T00:00:00`).getDay(); // 0..6 (0=Dom)

    // 1) Excepción por día exacto
    const exDia = Array.isArray(sede.excepciones)
      ? sede.excepciones.find(e => e.fecha === fecha)
      : null;

    if (exDia) {
      const anulan = ['descanso', 'festivo', 'evento', 'suspension', 'media_jornada', 'personalizado'];
      if (exDia.tipo === 'asistencia' && exDia.horaEntrada && exDia.horaSalida) {
        return res.json({
          origen: 'excepcion_dia',
          jornadas: [{ ini: to24h(exDia.horaEntrada), fin: to24h(exDia.horaSalida), overnight: false }]
        });
      }
      if (anulan.includes(exDia.tipo)) {
        return res.json({ origen: 'excepcion_dia', estado: exDia.tipo, jornadas: [] });
      }
    }

    // 2) Excepción por rango
    if (Array.isArray(sede.excepcionesRango)) {
      const hit = sede.excepcionesRango.find(r => {
        if (fecha < r.desde || fecha > r.hasta) return false;
        if (!r.dows || r.dows.length === 0) return true;
        return r.dows.includes(dow);
      });
      if (hit) {
        return res.json({
          origen: 'excepcion_rango',
          jornadas: (hit.jornadas || []).map(j => ({ ini: to24h(j.ini), fin: to24h(j.fin), overnight: !!j.overnight }))
        });
      }
    }

    // 3) Horario base
    const base = sede.horarioBase;
    if (!base || !Array.isArray(base.reglas)) {
      return res.json({ origen: 'sin_definir', jornadas: [] });
    }

    // (Opcional) Si quieres respetar que el base aplica desde "base.desde":
    // if (fecha < base.desde.toISOString().slice(0,10)) {
    //   return res.json({ origen: 'sin_definir', jornadas: [] });
    // }

    const regla = base.reglas.find(r => r.dow === dow);
    return res.json({ origen: 'horario_base', jornadas: (regla ? regla.jornadas : []) });
  } catch (e) {
    console.error('getHorarioAplicable', e);
    return res.status(500).json({ message: 'Error al resolver horario aplicable' });
  }
};
