// controllers/sedeController.js
const mongoose = require('mongoose');
const Sede = require('../models/Sede');

// GET /sedes/:sedeId/horario-base
exports.getHorarioBase = async (req, res) => {
  try {
    const sede = await Sede.findOne({ id: req.params.sedeId });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });
    return res.json(sede.horarioBase || null);
  } catch (e) {
    console.error('getHorarioBase', e);
    res.status(500).json({ message: 'Error al obtener horario base' });
  }
};

// PUT /sedes/:sedeId/horario-base
exports.setHorarioBase = async (req, res) => {
  try {
    const sede = await Sede.findOne({ id: req.params.sedeId });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });

    const { desde, reglas } = req.body || {};
    if (!desde || !Array.isArray(reglas)) {
      return res.status(400).json({ message: 'desde y reglas son obligatorios' });
    }

    // versioning
    const prevVersion = sede.horarioBase?.meta?.version || 0;
    sede.horarioBase = {
      desde: new Date(desde),
      reglas,
      meta: { version: prevVersion + 1 }
    };

    await sede.save();
    return res.json(sede.horarioBase);
  } catch (e) {
    console.error('setHorarioBase', e);
    res.status(500).json({ message: 'Error al guardar horario base' });
  }
};

// GET /sedes/:sedeId/excepciones
exports.listExcepciones = async (req, res) => {
  try {
    const sede = await Sede.findOne({ id: req.params.sedeId }, { excepciones: 1, _id: 0 });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });

    // ordenar por fecha desc y luego por createdAt desc
    const items = [...sede.excepciones].sort((a, b) => {
      if (a.fecha === b.fecha) return new Date(b.createdAt) - new Date(a.createdAt);
      return a.fecha < b.fecha ? 1 : -1;
    });

    res.json(items);
  } catch (e) {
    console.error('listExcepciones', e);
    res.status(500).json({ message: 'Error al listar excepciones' });
  }
};

// POST /sedes/:sedeId/excepciones
exports.createExcepcion = async (req, res) => {
  try {
    const sede = await Sede.findOne({ id: req.params.sedeId });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });

    const { fecha, tipo, descripcion = '', horaEntrada = '', horaSalida = '' } = req.body || {};
    if (!fecha || !tipo) {
      return res.status(400).json({ message: 'fecha y tipo son obligatorios' });
    }

    const nueva = {
      _id: new mongoose.Types.ObjectId(),
      fecha, tipo, descripcion, horaEntrada, horaSalida
    };

    sede.excepciones.unshift(nueva);
    await sede.save();

    res.status(201).json(nueva);
  } catch (e) {
    console.error('createExcepcion', e);
    res.status(500).json({ message: 'Error al crear excepción' });
  }
};

// DELETE /sedes/:sedeId/excepciones/:excepcionId
exports.deleteExcepcion = async (req, res) => {
  try {
    const sede = await Sede.findOne({ id: req.params.sedeId });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });

    const { excepcionId } = req.params;
    const before = sede.excepciones.length;
    sede.excepciones = sede.excepciones.filter(e => String(e._id) !== String(excepcionId));

    if (sede.excepciones.length === before) {
      return res.status(404).json({ message: 'Excepción no encontrada' });
    }

    await sede.save();
    res.json({ ok: true });
  } catch (e) {
    console.error('deleteExcepcion', e);
    res.status(500).json({ message: 'Error al eliminar excepción' });
  }
};
