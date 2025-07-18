const express = require('express');
const router = express.Router();
const trabajadoresController = require('../controllers/trabajadoresController');
const authMiddleware = require('../middleware/authMiddleware');

// 📌 Obtener todos los trabajadores
router.get('/', trabajadoresController.obtenerTrabajadores);

// 📌 Agregar un trabajador
router.post('/', trabajadoresController.agregarTrabajador);

// 📌 Eliminar un trabajador
router.delete('/:id', authMiddleware, trabajadoresController.eliminarTrabajador);

// 📌 Verificar contraseña antes de eliminar
router.post('/verificar-password', authMiddleware, trabajadoresController.verificarContraseña);

//------------------trabajador en particular--------------------
// 📌 Obtener un trabajador específico por ID (RUTA CORRECTA)
router.get('/:id', authMiddleware, trabajadoresController.obtenerTrabajadorPorId);

// 📌 Actualizar informacion de un trabajador específico por ID
router.put('/:id', authMiddleware, trabajadoresController.actualizarTrabajador);

// 📌 Obtener asistencias de un trabajador específico
router.get('/:id/asistencias', authMiddleware, trabajadoresController.obtenerAsistencias);

// 📌 Cambiar el estado del trabajdor (Sincronizado <-> Pendiente)
router.put('/sincronizacion/:id', authMiddleware, trabajadoresController.actualizarEstadoSincronizacion);

module.exports = router;
