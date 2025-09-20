const express = require('express');
const router = express.Router();
const trabajadoresController = require('../controllers/trabajadoresController');
const authMiddleware = require('../middleware/authMiddleware');

// 📌 Obtener todos los trabajadores (lista)
router.get('/', trabajadoresController.obtenerTrabajadores);

// 📌 Agregar un trabajador (alta)
router.post('/', trabajadoresController.agregarTrabajador);

// 📌 Eliminar un trabajador
router.delete('/:id', authMiddleware, trabajadoresController.eliminarTrabajador);

// 📌 Verificar contraseña (para acciones sensibles)
router.post('/verificar-password', authMiddleware, trabajadoresController.verificarContraseña);

//------------------trabajador en particular--------------------

// 🆕 📌 Actualizar SOLO sedes (sede principal + sedes foráneas)
router.put('/:id/sedes', authMiddleware, trabajadoresController.actualizarSedes);
router.put('/:id/sede', authMiddleware, trabajadoresController.actualizarSedes); // alias opcional

// 🆕 📌 Reparar/normalizar historial de sedes
router.put('/:id/historial/reparar', authMiddleware, trabajadoresController.repararHistorial);

// 📌 Obtener un trabajador por ID
router.get('/:id', authMiddleware, trabajadoresController.obtenerTrabajadorPorId);

// 📌 Actualizar trabajador por ID (sede/foráneas/estado/historial, etc.)
router.put('/:id', authMiddleware, trabajadoresController.actualizarTrabajador);

// 📌 Obtener asistencias de un trabajador específico
router.get('/:id/asistencias', authMiddleware, trabajadoresController.obtenerAsistencias);

// 📌 Cambiar estado de sincronización (Sincronizado <-> Pendiente)
router.put('/sincronizacion/:id', authMiddleware, trabajadoresController.actualizarEstadoSincronizacion);

// 📌 Obtener nuevo ingresos
router.post('/_cron/cerrar-nuevo-ingreso', authMiddleware, trabajadoresController.cerrarNuevoIngresoMasivo);

module.exports = router;
