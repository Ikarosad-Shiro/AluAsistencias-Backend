// routes/sedeRoutes.js
const express = require('express');
const router = express.Router();
const Sede = require('../models/Sede');

const auth = require('../middleware/authMiddleware');          // ✅ importar auth
const sedeCtrl = require('../controllers/sedeController');      // ✅ importar controlador
const verificarSedesAEliminar = require('../utils/verificarSedesAEliminar');

// ➕ Agregar nueva sede
router.post('/agregar', async (req, res) => {
  try {
    const { id, nombre, direccion, zona, responsable } = req.body;
    if (!id || !nombre) return res.status(400).json({ message: 'Faltan campos requeridos.' });

    const existe = await Sede.findOne({ id: Number(id) });      // 🔢 asegurar número
    if (existe) return res.status(400).json({ message: 'La sede con este ID ya existe.' });

    const nuevaSede = new Sede({ id, nombre, direccion, zona, responsable });
    await nuevaSede.save();
    res.status(201).json({ message: 'Sede agregada correctamente.', sede: nuevaSede });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 📋 Obtener todas las sedes
router.get('/todas', async (req, res) => {
  try {
    await verificarSedesAEliminar();
    const sedes = await Sede.find().sort({ id: 1 });
    res.json(sedes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 📍 Obtener sede por ID
router.get('/:id', async (req, res) => {
  try {
    const sede = await Sede.findOne({ id: Number(req.params.id) });   // 🔢 asegurar número
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada.' });
    res.json(sede);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✏️ Actualizar campos básicos
router.put('/:id', async (req, res) => {
  try {
    const { direccion, zona, responsable } = req.body;
    const sede = await Sede.findOneAndUpdate(
      { id: Number(req.params.id) },                                // 🔢 asegurar número
      { direccion, zona, responsable },
      { new: true }
    );
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada.' });
    res.json({ message: 'Sede actualizada correctamente.', sede });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🔥 Marcar sede para eliminación
router.put('/marcar-eliminacion/:id', async (req, res) => {
  try {
    const sede = await Sede.findOne({ id: Number(req.params.id) });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada.' });
    sede.estado = 'eliminacion_pendiente';
    sede.fechaEliminacionIniciada = new Date();
    await sede.save();
    res.json({ message: 'Sede marcada como en proceso de eliminación.', sede });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🔄 Cancelar eliminación
router.put('/cancelar-eliminacion/:id', async (req, res) => {
  try {
    const sede = await Sede.findOne({ id: Number(req.params.id) });
    if (!sede) return res.status(404).json({ message: 'Sede no encontrada.' });
    sede.estado = 'activa';
    sede.fechaEliminacionIniciada = null;
    await sede.save();
    res.json({ message: 'Eliminación cancelada. La sede ha sido restaurada como activa.', sede });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ============ NUEVO: Horario base & Excepciones ============ */
router.get('/:sedeId/horario-base', auth, sedeCtrl.getHorarioBase);
router.put('/:sedeId/horario-base', auth, sedeCtrl.setHorarioBase);

/* ===== Excepciones por DÍA ===== */
router.get('/:sedeId/excepciones', auth, sedeCtrl.listExcepciones);
router.post('/:sedeId/excepciones', auth, sedeCtrl.createExcepcion);
router.delete('/:sedeId/excepciones/:excepcionId', auth, sedeCtrl.deleteExcepcion);

// === Excepciones por RANGO ===
router.get('/:sedeId/excepciones-rango', auth, sedeCtrl.listExcepcionesRango);
router.post('/:sedeId/excepciones-rango', auth, sedeCtrl.createExcepcionRango);
router.delete('/:sedeId/excepciones-rango/:rangoId', auth, sedeCtrl.deleteExcepcionRango);

// === Resolver horario aplicable en una fecha ===
router.get('/:sedeId/horario-aplicable', auth, sedeCtrl.getHorarioAplicable);

module.exports = router;
