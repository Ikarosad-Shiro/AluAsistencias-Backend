// routes/sedeRoutes.js
const express = require('express');
const router = express.Router();
const Sede = require('../models/Sede');

// ➕ Agregar nueva sede
router.post('/agregar', async (req, res) => {
  try {
    const { id, nombre, direccion, zona, responsable } = req.body;

    if (!id || !nombre) {
      return res.status(400).json({ message: 'Faltan campos requeridos.' });
    }

    const existe = await Sede.findOne({ id });
    if (existe) {
      return res.status(400).json({ message: 'La sede con este ID ya existe.' });
    }

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
    const sedes = await Sede.find().sort({ id: 1 });
    res.json(sedes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 📍 Obtener sede por ID (para detalle)
router.get('/:id', async (req, res) => {
  try {
    const sede = await Sede.findOne({ id: req.params.id });
    if (!sede) {
      return res.status(404).json({ message: 'Sede no encontrada.' });
    }
    res.json(sede);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✏️ Actualizar campos editables (dirección, zona, responsable)
router.put('/:id', async (req, res) => {
  try {
    const { direccion, zona, responsable } = req.body;

    const sede = await Sede.findOneAndUpdate(
      { id: req.params.id },
      { direccion, zona, responsable },
      { new: true }
    );

    if (!sede) {
      return res.status(404).json({ message: 'Sede no encontrada.' });
    }

    res.json({ message: 'Sede actualizada correctamente.', sede });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🔥 Marcar sede como en proceso de eliminación
router.put('/marcar-eliminacion/:id', async (req, res) => {
  try {
    const sede = await Sede.findOne({ id: req.params.id });
    if (!sede) {
      return res.status(404).json({ message: 'Sede no encontrada.' });
    }

    sede.estado = 'eliminacion_pendiente';
    sede.fechaEliminacionIniciada = new Date();
    await sede.save();

    res.json({ message: 'Sede marcada como en proceso de eliminación.', sede });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🔄 Cancelar eliminación de sede
router.put('/cancelar-eliminacion/:id', async (req, res) => {
  try {
    const sede = await Sede.findOne({ id: req.params.id });
    if (!sede) {
      return res.status(404).json({ message: 'Sede no encontrada.' });
    }

    sede.estado = 'activa';
    sede.fechaEliminacionIniciada = null;
    await sede.save();

    res.json({ message: 'Eliminación cancelada. La sede ha sido restaurada como activa.', sede });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
