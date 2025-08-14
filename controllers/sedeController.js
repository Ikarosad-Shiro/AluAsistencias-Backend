// controllers/sedeController.js
const mongoose = require('mongoose');
const Sede = require('../models/Sede');

/* ========== HORARIO BASE ========== */
exports.getHorarioBase = async (req, res) => {
  try {
    const sede = await Sede.findOne({ id: req.params.sedeId });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });
    res.json(sede.horarioBase || null);
  } catch (e) {
    console.error('getHorarioBase', e);
    res.status(500).json({ message: 'Error al obtener horario base' });
  }
};

exports.setHorarioBase = async (req, res) => {
  try {
    const sede = await Sede.findOne({ id: req.params.sedeId });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });

    const { desde, reglas } = req.body || {};
    if (!desde || !Array.isArray(reglas)) {
      return res.status(400).json({ message: 'desde y reglas son obligatorios' });
    }
    const prevVersion = sede.horarioBase?.meta?.version || 0;
    sede.horarioBase = { desde: new Date(desde), reglas, meta: { version: prevVersion + 1 } };

    await sede.save();
    res.json(sede.horarioBase);
  } catch (e) {
    console.error('setHorarioBase', e);
    res.status(500).json({ message: 'Error al guardar horario base' });
  }
};

/* ========== EXCEPCIONES POR DÍA (YA EXISTÍAN) ========== */
exports.listExcepciones = async (req, res) => {
  try {
    const sede = await Sede.findOne({ id: req.params.sedeId }, { excepciones: 1, _id: 0 });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });
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

exports.createExcepcion = async (req, res) => {
  try {
    const sede = await Sede.findOne({ id: req.params.sedeId });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });

    const { fecha, tipo, descripcion = '', horaEntrada = '', horaSalida = '' } = req.body || {};
    if (!fecha || !tipo) return res.status(400).json({ message: 'fecha y tipo son obligatorios' });

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

exports.deleteExcepcion = async (req, res) => {
  try {
    const sede = await Sede.findOne({ id: req.params.sedeId });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });

    const before = sede.excepciones.length;
    sede.excepciones = sede.excepciones.filter(e => String(e._id) !== String(req.params.excepcionId));
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

/* ========== EXCEPCIONES POR RANGO (NUEVO) ========== */
exports.listExcepcionesRango = async (req, res) => {
  try {
    const sede = await Sede.findOne({ id: req.params.sedeId }, { excepcionesRango: 1, _id: 0 });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });
    const items = [...sede.excepcionesRango].sort((a, b) => a.desde < b.desde ? -1 : 1);
    res.json(items);
  } catch (e) {
    console.error('listExcepcionesRango', e);
    res.status(500).json({ message: 'Error al listar excepciones por rango' });
  }
};

exports.createExcepcionRango = async (req, res) => {
  try {
    const sede = await Sede.findOne({ id: req.params.sedeId });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });

    const { desde, hasta, dows = [], jornadas = [], descripcion = '' } = req.body || {};
    if (!desde || !hasta || !Array.isArray(jornadas) || jornadas.length === 0) {
      return res.status(400).json({ message: 'desde, hasta y jornadas son obligatorios' });
    }

    const nueva = { desde, hasta, dows, jornadas, descripcion };
    sede.excepcionesRango.push(nueva);
    await sede.save();
    res.status(201).json(nueva);
  } catch (e) {
    console.error('createExcepcionRango', e);
    res.status(500).json({ message: 'Error al crear excepción por rango' });
  }
};

exports.deleteExcepcionRango = async (req, res) => {
  try {
    const sede = await Sede.findOne({ id: req.params.sedeId });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });

    const before = sede.excepcionesRango.length;
    sede.excepcionesRango = sede.excepcionesRango.filter(e => String(e._id) !== String(req.params.rangoId));
    if (sede.excepcionesRango.length === before) {
      return res.status(404).json({ message: 'Excepción de rango no encontrada' });
    }
    await sede.save();
    res.json({ ok: true });
  } catch (e) {
    console.error('deleteExcepcionRango', e);
    res.status(500).json({ message: 'Error al eliminar excepción por rango' });
  }
};

/* ========== RESOLVER HORARIO APLICABLE ========== */
exports.getHorarioAplicable = async (req, res) => {
  try {
    const { sedeId } = req.params;
    const { fecha } = req.query; // "YYYY-MM-DD"
    if (!fecha) return res.status(400).json({ message: 'Query ?fecha=YYYY-MM-DD es obligatoria' });

    const sede = await Sede.findOne({ id: sedeId });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada' });

    const dow = new Date(fecha + 'T00:00:00').getDay(); // 0..6

    // 1) Excepción por DÍA exacto
    const exDia = sede.excepciones.find(e => e.fecha === fecha);
    if (exDia) {
      const anulan = ['descanso','festivo','evento','suspension','media_jornada','personalizado'];
      if (exDia.tipo === 'asistencia' && exDia.horaEntrada && exDia.horaSalida) {
        return res.json({ origen: 'excepcion_dia', jornadas: [{ ini: exDia.horaEntrada, fin: exDia.horaSalida, overnight: false }] });
      }
      if (anulan.includes(exDia.tipo)) {
        return res.json({ origen: 'excepcion_dia', estado: exDia.tipo, jornadas: [] });
      }
    }

    // 2) Excepción por RANGO
    if (Array.isArray(sede.excepcionesRango)) {
      const hit = sede.excepcionesRango.find(r => {
        if (fecha < r.desde || fecha > r.hasta) return false;
        if (!r.dows || r.dows.length === 0) return true;
        return r.dows.includes(dow);
      });
      if (hit) {
        return res.json({ origen: 'excepcion_rango', jornadas: hit.jornadas });
      }
    }

    // 3) Horario base
    const base = sede.horarioBase;
    if (!base || !Array.isArray(base.reglas)) {
      return res.json({ origen: 'sin_definir', jornadas: [] });
    }
    const regla = base.reglas.find(r => r.dow === dow);
    return res.json({ origen: 'horario_base', jornadas: regla ? regla.jornadas : [] });
  } catch (e) {
    console.error('getHorarioAplicable', e);
    res.status(500).json({ message: 'Error al resolver horario aplicable' });
  }
};
