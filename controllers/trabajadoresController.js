const Trabajador = require('../models/Trabajador');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Asistencia = require('../models/Asistencia');
const Sede = require('../models/Sede');

// =========================
// Helpers
// =========================
const toNum = (v) =>
  v === undefined || v === null || v === '' || Number.isNaN(Number(v))
    ? null
    : Number(v);

const uniqNums = (arr = []) =>
  [...new Set((Array.isArray(arr) ? arr : []).map(n => Number(n)))];

// =========================
// Controladores
// =========================

// 🔥 Obtener todos los trabajadores
const obtenerTrabajadores = async (_req, res) => {
  try {
    // Incluimos campos nuevos + compat con FE (sede/estado/sincronizado)
    const trabajadores = await Trabajador.find(
      {},
      '_id nombre sede sedePrincipal sedesForaneas id_checador sincronizado estado'
    );
    res.status(200).json(trabajadores);
  } catch (error) {
    console.error("❌ Error al obtener trabajadores:", error);
    res.status(500).json({ message: "Error al obtener trabajadores" });
  }
};

// 🔥 Agregar un nuevo trabajador (multisede + espejo 'sede')
const agregarTrabajador = async (req, res) => {
  try {
    const {
      nombre,
      sede,                 // legacy (por compat)
      sedePrincipal,        // nuevo
      sedesForaneas = [],   // nuevo
      // opcionales
      correo, telefono, telefonoEmergencia, direccion, puesto,
      estado, sincronizado, fechaAlta,
      id_checador           // si lo mandas manual, se respeta
    } = req.body;

    const principal = toNum(sedePrincipal ?? sede);
    if (!nombre || principal === null) {
      return res.status(400).json({ message: "Nombre y sede principal son requeridos" });
    }

    // 🧠 Obtener nombre de la sede para historial
    const sedeDoc = await Sede.findOne({ id: principal });
    const nombreSede = sedeDoc?.nombre || 'Desconocida';

    // ✅ Generar id_checador si no viene en la petición
    let nuevoIdChecador = id_checador ?? null;
    if (nuevoIdChecador === null || Number.isNaN(Number(nuevoIdChecador))) {
      const ultimo = await Trabajador.findOne().sort({ id_checador: -1 }).select('id_checador');
      nuevoIdChecador = (ultimo && !isNaN(ultimo.id_checador)) ? ultimo.id_checador + 1 : 100;
    }

    // 🧹 Foráneas: únicas y sin la principal
    const foraneas = uniqNums(sedesForaneas).filter(id => id !== principal);

    const ahora = new Date();

    const nuevoTrabajador = new Trabajador({
      nombre: nombre.trim(),

      // Espejo legacy (para que todo lo viejo siga funcionando)
      sede: principal,

      // Nuevo modelo multisede
      sedePrincipal: principal,
      sedesForaneas: foraneas,
      historialSedes: [{
        idSede: principal,
        nombre: nombreSede,
        fechaInicio: ahora,
        fechaFin: null
      }],

      // Checador
      id_checador: Number(nuevoIdChecador),

      // Otros datos
      sincronizado: !!sincronizado,
      correo: correo || '',
      telefono: telefono || '',
      telefonoEmergencia: telefonoEmergencia || '',
      direccion: direccion || '',
      puesto: puesto || '',
      estado: estado || 'activo',
      fechaAlta: fechaAlta ? new Date(fechaAlta) : null
    });

    await nuevoTrabajador.save();

    res.status(201).json({
      message: "Trabajador agregado correctamente",
      trabajador: nuevoTrabajador
    });
  } catch (error) {
    console.error("❌ Error al agregar trabajador:", error);
    res.status(500).json({ message: "Error al agregar trabajador" });
  }
};

// 🔥 Eliminar trabajador por ID
const eliminarTrabajador = async (req, res) => {
  try {
    const { id } = req.params;
    await Trabajador.findByIdAndDelete(id);
    res.status(200).json({ message: 'Trabajador eliminado correctamente.' });
  } catch (error) {
    console.error('❌ Error al eliminar trabajador:', error);
    res.status(500).json({ message: 'Error al eliminar trabajador' });
  }
};

// 🔒 Verificar contraseña del usuario
const verificarContraseña = async (req, res) => {
  try {
    const { contraseña } = req.body;
    const userId = req.user.id; // desde token (authMiddleware)
    const user = await User.findById(userId);

    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

    const contraseñaValida = await bcrypt.compare(contraseña, user.password);
    if (!contraseñaValida) return res.status(401).json({ message: 'Contraseña incorrecta' });

    res.status(200).json(true);
  } catch (error) {
    console.error('❌ Error al verificar contraseña:', error);
    res.status(500).json({ message: 'Error al verificar contraseña' });
  }
};

// 🔥 Obtener un trabajador por ID
const obtenerTrabajadorPorId = async (req, res) => {
  try {
    const { id } = req.params;
    const trabajador = await Trabajador.findById(id);

    if (!trabajador) return res.status(404).json({ message: 'Trabajador no encontrado' });

    res.status(200).json(trabajador);
  } catch (error) {
    console.error('❌ Error al obtener trabajador por ID:', error);
    res.status(500).json({ message: 'Error al obtener trabajador' });
  }
};

// 🔄 Actualizar un trabajador (sede principal/foráneas/estado/historial/sincronizado/etc.)
const actualizarTrabajador = async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};

    const t = await Trabajador.findById(id);
    if (!t) return res.status(404).json({ message: 'Trabajador no encontrado' });

    // ===== ESTADO =====
    if (body.estado === 'inactivo') {
      // Desactivación
      t.estado = 'inactivo';
      t.sincronizado = false;
      t.sedesForaneas = [];
      t.sede = null;
      t.sedePrincipal = null;

      // Cerrar historial abierto
      const abierto = (t.historialSedes || []).find(h => !h.fechaFin);
      if (abierto) abierto.fechaFin = new Date();
    } else if (body.estado === 'activo') {
      t.estado = 'activo';
    }

    // ===== CAMBIO DE SEDE PRINCIPAL (acepta body.sede o body.sedePrincipal) =====
    if (Object.prototype.hasOwnProperty.call(body, 'sede') ||
        Object.prototype.hasOwnProperty.call(body, 'sedePrincipal')) {

      const nuevaPrincipal = toNum(body.sedePrincipal ?? body.sede);

      if (nuevaPrincipal !== null && nuevaPrincipal !== t.sedePrincipal) {
        // Cierra historial abierto
        const abierto = (t.historialSedes || []).find(h => !h.fechaFin);
        if (abierto) abierto.fechaFin = new Date();

        // Busca nombre de la sede
        const sedeDoc = await Sede.findOne({ id: nuevaPrincipal });
        const nombreSede = sedeDoc?.nombre || '';

        // Abre nuevo historial
        t.historialSedes = Array.isArray(t.historialSedes) ? t.historialSedes : [];
        t.historialSedes.push({
          idSede: nuevaPrincipal,
          nombre: nombreSede,
          fechaInicio: new Date(),
          fechaFin: null
        });

        // Actualiza espejo
        t.sedePrincipal = nuevaPrincipal;
        t.sede = nuevaPrincipal;
        t.sincronizado = false; // para que el checador refresque
      }
    }

    // ===== SEDES FORÁNEAS =====
    if (Array.isArray(body.sedesForaneas)) {
      const principal = toNum(t.sedePrincipal);
      t.sedesForaneas = uniqNums(body.sedesForaneas).filter(x => x !== principal);
    }

    // ===== CAMPOS SIMPLES =====
    const simples = [
      'nombre', 'correo', 'telefono', 'telefonoEmergencia',
      'direccion', 'puesto', 'sincronizado', 'fechaAlta'
    ];
    simples.forEach(k => {
      if (Object.prototype.hasOwnProperty.call(body, k)) {
        t[k] = (k === 'fechaAlta' && body[k]) ? new Date(body[k]) : body[k];
      }
    });

    const saved = await t.save();
    res.status(200).json(saved);
  } catch (error) {
    console.error('❌ Error al actualizar trabajador:', error);
    res.status(500).json({ message: 'Error al actualizar trabajador' });
  }
};

// 🔥 Obtener asistencias de un trabajador específico usando id_checador + sede actual
const obtenerAsistencias = async (req, res) => {
  try {
    const { id } = req.params;

    const trabajador = await Trabajador.findById(id);
    if (!trabajador) return res.status(404).json({ message: 'Trabajador no encontrado' });

    const sedeBusqueda = trabajador.sedePrincipal ?? trabajador.sede;
    const asistencias = await Asistencia.find({
      trabajador: trabajador.id_checador,
      sede: sedeBusqueda
    });

    res.status(200).json(asistencias);
  } catch (error) {
    console.error('❌ Error al obtener asistencias:', error);
    res.status(500).json({ message: 'Error al obtener asistencias' });
  }
};

// 🔁 Cambiar estado de sincronización (select de la tabla)
const actualizarEstadoSincronizacion = async (req, res) => {
  try {
    const { id } = req.params;
    const { sincronizado } = req.body;

    const trabajador = await Trabajador.findById(id);
    if (!trabajador) return res.status(404).json({ message: 'Trabajador no encontrado' });

    trabajador.sincronizado = !!sincronizado;
    await trabajador.save();

    res.status(200).json({ message: 'Estado de sincronización actualizado', trabajador });
  } catch (error) {
    console.error('❌ Error al actualizar sincronización:', error);
    res.status(500).json({ message: 'Error al actualizar sincronización' });
  }
};

module.exports = {
  obtenerTrabajadores,
  agregarTrabajador,
  eliminarTrabajador,
  verificarContraseña,
  obtenerTrabajadorPorId,
  actualizarTrabajador,
  obtenerAsistencias,
  actualizarEstadoSincronizacion,
};
