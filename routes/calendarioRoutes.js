const express = require('express');
const router = express.Router();
const Calendario = require('../models/Calendario');

const verifyToken = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/authMiddleware');

const { toDay, getSundaysInRange, groupByYear } = require('../utils/date');
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

// ➕ Agregar un día especial
router.post('/agregar-dia', async (req, res) => {
  try {
    const { año, sede, fecha, tipo, descripcion } = req.body;

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

    const fechaISO = new Date(fecha).toISOString().slice(0, 10);

    let calendario = await Calendario.findOne({ año, sedes: { $in: [sede] } });

    if (!calendario) {
      calendario = new Calendario({ año, sedes: [sede], diasEspeciales: [] });
    }

    const existe = calendario.diasEspeciales.some(
      d => d.fecha.toISOString().slice(0, 10) === fechaISO
    );

    if (existe) {
      return res.status(400).json({ message: 'Ese día ya está configurado.' });
    }

    // ✅ Aseguramos que fecha sea Date
    calendario.diasEspeciales.push({
      fecha: new Date(fecha),
      tipo,
      descripcion: descripcion || ''
    });

    await calendario.save();

    res.json({ message: 'Día especial agregado con éxito', calendario });
  } catch (error) {
    console.error('❌ Error en /agregar-dia:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✏️ Editar un día especial
router.put('/editar-dia', async (req, res) => {
  try {
    const { año, sede, fecha, tipo, descripcion } = req.body;

    if (!año || !sede || !fecha || !tipo) {
      return res.status(400).json({ message: 'Faltan campos obligatorios.' });
    }

    const calendario = await Calendario.findOne({ año, sedes: { $in: [sede] } });
    if (!calendario) {
      return res.status(404).json({ message: 'Calendario no encontrado.' });
    }

    const fechaISO = new Date(fecha).toISOString().slice(0, 10);

    const dia = calendario.diasEspeciales.find(
      d => d.fecha.toISOString().slice(0, 10) === fechaISO
    );

    if (!dia) {
      return res.status(404).json({ message: 'Día no encontrado en el calendario.' });
    }

    // Actualizar campos
    dia.tipo = tipo;
    dia.descripcion = descripcion || '';

    await calendario.save();
    res.json({ message: 'Día actualizado correctamente', calendario });
  } catch (error) {
    console.error('❌ Error en /editar-dia:', error);
    res.status(500).json({ error: error.message });
  }
});

// ❌ Eliminar un día especial
router.delete('/eliminar-dia', async (req, res) => {
  try {
    const { año, sede, fecha } = req.body;

    console.log('🧨 Petición para eliminar día:', { año, sede, fecha });

    const calendario = await Calendario.findOne({ año, sedes: { $in: [sede] } });
    if (!calendario) return res.status(404).json({ message: 'Calendario no encontrado.' });

    const fechaISO = new Date(fecha).toISOString().slice(0, 10);

    const cantidadAntes = calendario.diasEspeciales.length;

    calendario.diasEspeciales = calendario.diasEspeciales.filter(
      d => d.fecha.toISOString().slice(0, 10) !== fechaISO
    );

    const cantidadDespues = calendario.diasEspeciales.length;

    if (cantidadAntes === cantidadDespues) {
      return res.status(404).json({ message: 'Día no encontrado para eliminar.' });
    }

    await calendario.save();

    console.log('✅ Día eliminado correctamente.');
    res.json({ message: 'Día eliminado del calendario', calendario });
  } catch (error) {
    console.error('❌ Error al eliminar día:', error);
    res.status(500).json({ error: error.message });
  }
});

// 🕊️ PREVIEW asistente de domingo
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

      const domingos = getSundaysInRange(start, end);
      if (!domingos.length) return res.json({ totalDomingos: 0, aCrear: 0, conEvento: 0, sedesProcesadas: sedeIds.length, detalle: [] });

      const porAño = groupByYear(domingos);
      const años = Object.keys(porAño).map(Number);

      const docs = await Calendario.find(
        { año: { $in: años }, sedes: { $in: sedeIds } },
        { año: 1, sedes: 1, diasEspeciales: 1 }
      ).lean();

      // year|sede -> Set('YYYY-MM-DD')
      const existing = new Map();
      for (const doc of docs) {
        const fechasSet = new Set((doc.diasEspeciales || []).map(e => new Date(e.fecha).toISOString().slice(0,10)));
        for (const s of doc.sedes) existing.set(`${doc.año}|${s}`, fechasSet);
      }

      let aCrear = 0, conEvento = 0;
      const detalle = [];

      for (const sede of sedeIds) {
        for (const d of domingos) {
          const iso = d.toISOString().slice(0,10);
          const set = existing.get(`${d.getUTCFullYear()}|${sede}`);
          if (set && set.has(iso)) { conEvento++; detalle.push({ sede, fecha: d, motivo: 'ocupado' }); }
          else { aCrear++; detalle.push({ sede, fecha: d, motivo: 'crear' }); }
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

// ✅ APPLY asistente de domingo (bulk idempotente)
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
      const domingos = getSundaysInRange(start, end);
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
            (doc?.diasEspeciales || []).map(e => new Date(e.fecha).toISOString().slice(0,10))
          );

          const faltantes = fechas.filter(d => !existentesSet.has(d.toISOString().slice(0,10)));
          if (!faltantes.length) { skipped += fechas.length; continue; }

          const nuevos = faltantes.map(d => ({
            fecha: d,
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
          skipped += (fechas.length - nuevos.length);
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
