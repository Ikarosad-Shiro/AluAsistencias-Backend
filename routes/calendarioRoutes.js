const express = require('express');
const router = express.Router();
const Calendario = require('../models/Calendario');

const verifyToken = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/authMiddleware');

// ✅ Helpers de fecha robustos (usa la versión que te pasé)
const {
  toDay,                 // normaliza a mediodía UTC
  getSundaysInRange,     // devuelve domingos normalizados
  groupByYear,           // agrupa por año (UTC)
  toYmd,                 // Date/ISO/YMD -> 'YYYY-MM-DD'
  ymdToNoonUTC           // 'YYYY-MM-DD' -> Date 12:00Z
} = require('../utils/date');

const { v4: uuidv4 } = require('uuid'); // npm i uuid

// 💖 Ruta de prueba
router.get('/ping', (req, res) => {
  res.send('💖 ¡La ruta calendario está viva!');
});

// 🔍 Ver todos los calendarios
router.get('/todos', async (req, res) => {
  try {
    const calendarios = await Calendario.find();
    res.json(calendarios);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🔍 Obtener calendario por sede y año
router.get('/sede/:sede/anio/:anio', async (req, res) => {
  try {
    const anio = parseInt(req.params.anio);
    const sede = parseInt(req.params.sede);

    const calendario = await Calendario.findOne({
      año: anio,
      sedes: { $in: [sede] }
    });

    if (!calendario) {
      return res.status(404).json({ message: 'Calendario no encontrado para esta sede y año.' });
    }

    res.json(calendario);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ➕ Agregar un día especial (idempotente por YMD, guarda 12:00Z)
router.post('/agregar-dia', async (req, res) => {
  try {
    const { año, sede, fecha, tipo, descripcion, horaInicio, horaFin } = req.body;

    if (!año || !sede || !fecha || !tipo) {
      return res.status(400).json({ message: 'Faltan campos obligatorios.' });
    }

    const tiposValidos = [
      'festivo', 'puente', 'descanso',
      'media jornada', 'capacitación',
      'evento', 'suspensión'
    ];
    if (!tiposValidos.includes(tipo)) {
      return res.status(400).json({ message: `Tipo inválido. Debe ser uno de: ${tiposValidos.join(', ')}` });
    }

    // Normaliza a YYYY-MM-DD (estable)
    const fechaYmd = toYmd(fecha);

    // Trae/calienta el doc
    let calendario = await Calendario.findOne({ año, sedes: { $in: [sede] } });
    if (!calendario) {
      calendario = new Calendario({ año, sedes: [sede], diasEspeciales: [] });
    }

    // ¿Ya existe ese día? (comparación por YMD)
    const existe = (calendario.diasEspeciales || []).some(d => toYmd(d.fecha) === fechaYmd);
    if (existe) {
      // Usa 409 para que el front sepa que es duplicado (no error genérico)
      return res.status(409).json({ message: 'Ese día ya está configurado.' });
    }

    // Inserta como 12:00Z para evitar “corrimientos”
// Inserta como 12:00Z para evitar “corrimientos”
const nuevo = {
  fecha: ymdToNoonUTC(fechaYmd),
  tipo,
  descripcion: descripcion || ''
};

// ✅ Validación explícita de media jornada antes de guardar
if (tipo === 'media jornada') {
  const formatoHora = /^([01]\d|2[0-3]):[0-5]\d$/;

  if (!formatoHora.test(horaInicio || '') || !formatoHora.test(horaFin || '')) {
    return res.status(400).json({
      message: 'Media jornada requiere horaInicio y horaFin en formato HH:mm'
    });
  }

  nuevo.horaInicio = horaInicio;
  nuevo.horaFin = horaFin;
}

/**
 * ✅ Importante:
 * Usamos $push para agregar el día sin revalidar todo el arreglo diasEspeciales.
 * Esto evita que un registro viejo de media jornada sin horas bloquee el guardado.
 */
if (calendario._id) {
  await Calendario.updateOne(
    { _id: calendario._id },
    { $push: { diasEspeciales: nuevo } }
  );

  const actualizado = await Calendario.findById(calendario._id);

  return res.status(201).json({
    message: 'Día especial agregado con éxito',
    calendario: actualizado
  });
}

// Si no existía calendario, creamos uno nuevo con el evento validado
const creado = await Calendario.create({
  año,
  sedes: [sede],
  diasEspeciales: [nuevo]
});

res.status(201).json({
  message: 'Día especial agregado con éxito',
  calendario: creado
});
  } catch (error) {
    console.error('❌ Error en /agregar-dia:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✏️ Editar un día especial (match por YMD)
router.put('/editar-dia', async (req, res) => {
  try {
    const { año, sede, fecha, tipo, descripcion, horaInicio, horaFin } = req.body;

    if (!año || !sede || !fecha || !tipo) {
      return res.status(400).json({ message: 'Faltan campos obligatorios.' });
    }

    const calendario = await Calendario.findOne({ año, sedes: { $in: [sede] } });
    if (!calendario) {
      return res.status(404).json({ message: 'Calendario no encontrado.' });
    }

    const fechaYmd = toYmd(fecha);

    const dia = (calendario.diasEspeciales || []).find(d => toYmd(d.fecha) === fechaYmd);
    if (!dia) {
      return res.status(404).json({ message: 'Día no encontrado en el calendario.' });
    }

    // Actualiza campos
    dia.tipo = tipo;
    dia.descripcion = descripcion || '';

    if (tipo === 'media jornada') {
      dia.horaInicio = horaInicio ?? dia.horaInicio ?? null;
      dia.horaFin = horaFin ?? dia.horaFin ?? null;
    } else {
      // El pre('validate') del modelo limpia horas en otros tipos, pero por claridad:
      dia.horaInicio = null;
      dia.horaFin = null;
    }

    await calendario.save();
    res.json({ message: 'Día actualizado correctamente', calendario });
  } catch (error) {
    console.error('❌ Error en /editar-dia:', error);
    res.status(500).json({ error: error.message });
  }
});

// ❌ Eliminar un día especial (match por YMD)
router.delete('/eliminar-dia', async (req, res) => {
  try {
    const { año, sede, fecha } = req.body;

    const calendario = await Calendario.findOne({ año, sedes: { $in: [sede] } });
    if (!calendario) return res.status(404).json({ message: 'Calendario no encontrado.' });

    const fechaYmd = toYmd(fecha);

    const cantidadAntes = (calendario.diasEspeciales || []).length;
    calendario.diasEspeciales = (calendario.diasEspeciales || []).filter(d => toYmd(d.fecha) !== fechaYmd);
    const cantidadDespues = calendario.diasEspeciales.length;

    if (cantidadAntes === cantidadDespues) {
      return res.status(404).json({ message: 'Día no encontrado para eliminar.' });
    }

    await calendario.save();
    res.json({ message: 'Día eliminado del calendario', calendario });
  } catch (error) {
    console.error('❌ Error al eliminar día:', error);
    res.status(500).json({ error: error.message });
  }
});

// 🕊️ PREVIEW asistente de domingo (devuelve fechas en YMD)
router.post('/asistente-domingo/preview',
  verifyToken, requireRole(['Administrador', 'Dios']),
  async (req, res) => {
    try {
      const { sedeIds = [], inicio, fin } = req.body || {};
      if (!Array.isArray(sedeIds) || !sedeIds.length) return res.status(400).json({ message: 'sedeIds requerido' });
      if (!inicio || !fin) return res.status(400).json({ message: 'inicio/fin requeridos' });

      const start = toDay(inicio);
      const end   = toDay(fin);

      // límite de seguridad server-side
      const maxDays = 120;
      const diffDays = Math.ceil((end - start) / 86400000) + 1;
      if (diffDays > maxDays) return res.status(400).json({ message: `Rango demasiado grande (>${maxDays} días)` });

      const domingos = getSundaysInRange(start, end); // Dates a 12:00Z
      if (!domingos.length) {
        return res.json({ totalDomingos: 0, aCrear: 0, conEvento: 0, sedesProcesadas: sedeIds.length, detalle: [] });
      }

      const porAño = groupByYear(domingos);
      const años = Object.keys(porAño).map(Number);

      const docs = await Calendario.find(
        { año: { $in: años }, sedes: { $in: sedeIds } },
        { año: 1, sedes: 1, diasEspeciales: 1 }
      ).lean();

      // year|sede -> Set('YYYY-MM-DD')
      const existing = new Map();
      for (const doc of docs) {
        const fechasSet = new Set((doc.diasEspeciales || []).map(e => toYmd(e.fecha)));
        for (const s of doc.sedes) existing.set(`${doc.año}|${s}`, fechasSet);
      }

      let aCrear = 0, conEvento = 0;
      const detalle = [];

      for (const sede of sedeIds) {
        for (const d of domingos) {
          const ymd = toYmd(d);
          const set = existing.get(`${d.getUTCFullYear()}|${sede}`);
          if (set && set.has(ymd)) {
            conEvento++;
            detalle.push({ sede, fechaYmd: ymd, motivo: 'ocupado' });
          } else {
            aCrear++;
            detalle.push({ sede, fechaYmd: ymd, motivo: 'crear' });
          }
        }
      }

      res.json({
        totalDomingos: domingos.length * sedeIds.length,
        aCrear, conEvento,
        sedesProcesadas: sedeIds.length,
        detalle
      });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  }
);

// ✅ APPLY asistente de domingo (bulk idempotente, guarda 12:00Z)
router.post('/asistente-domingo/apply',
  verifyToken, requireRole(['Administrador', 'Dios']),
  async (req, res) => {
    try {
      const { sedeIds = [], inicio, fin, descripcion = 'Asistente de Domingo' } = req.body || {};
      const user = req.user || {};
      if (!Array.isArray(sedeIds) || !sedeIds.length) return res.status(400).json({ message: 'sedeIds requerido' });
      if (!inicio || !fin) return res.status(400).json({ message: 'inicio/fin requeridos' });

      const start = toDay(inicio);
      const end   = toDay(fin);
      const domingos = getSundaysInRange(start, end); // Dates a 12:00Z
      if (!domingos.length) return res.json({ batchId: null, created: 0, skipped: 0 });

      const batchId = uuidv4();
      const autor = user?.email || user?._id || 'system';
      const porAño = groupByYear(domingos);

      let created = 0;
      let skipped = 0;

      for (const [añoStr, fechas] of Object.entries(porAño)) {
        const año = Number(añoStr);

        // trae todos los docs del año con cualquiera de las sedes
        const docs = await Calendario.find(
          { año, sedes: { $in: sedeIds } },
          { año: 1, sedes: 1, diasEspeciales: 1 }
        ).lean();

        const docBySede = new Map();
        for (const doc of docs) for (const s of doc.sedes) docBySede.set(s, doc);

        for (const sede of sedeIds) {
          const doc = docBySede.get(sede);
          const existentesSet = new Set(
            (doc?.diasEspeciales || []).map(e => toYmd(e.fecha))
          );

          // candidatos en YMD
          const candidatosYmd = fechas.map(d => toYmd(d));
          const faltantesYmd = candidatosYmd.filter(ymd => !existentesSet.has(ymd));

          if (!faltantesYmd.length) {
            skipped += candidatosYmd.length;
            continue;
          }

          const nuevos = faltantesYmd.map(ymd => ({
            fecha: ymdToNoonUTC(ymd),
            tipo: 'descanso',
            descripcion,
            source: 'asistente-domingo',
            batchId,
            createdBy: autor,
            createdAt: new Date()
          }));

          if (doc) {
            await Calendario.updateOne(
              { _id: doc._id },
              { $push: { diasEspeciales: { $each: nuevos } } }
            );
          } else {
            await Calendario.create({ año, sedes: [sede], diasEspeciales: nuevos });
          }

          created += nuevos.length;
          skipped += (candidatosYmd.length - nuevos.length);
        }
      }

      res.json({ batchId, created, skipped });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  }
);

// 🔙 UNDO por batchId
router.post('/asistente-domingo/undo',
  verifyToken, requireRole(['Administrador', 'Dios']),
  async (req, res) => {
    try {
      const { batchId } = req.body || {};
      if (!batchId) return res.status(400).json({ message: 'batchId requerido' });

      const r = await Calendario.updateMany(
        {},
        { $pull: { diasEspeciales: { source: 'asistente-domingo', batchId } } }
      );

      res.json({ modifiedCount: r.modifiedCount });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  }
);

module.exports = router;
