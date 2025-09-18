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

// Normaliza un arreglo de historial (solo en memoria, para respuesta)
const normalizeHistorialArray = async (arr = []) => {
  if (!Array.isArray(arr)) return [];
  // Coerce types + fill nombre si está vacío
  const normalizados = [];
  for (const h of arr) {
    const idSedeNum = toNum(h.idSede);
    let nombre = (h.nombre || '').trim();

    if (!nombre && idSedeNum !== null) {
      const sedeDoc = await Sede.findOne({ id: idSedeNum }).select('nombre');
      nombre = sedeDoc?.nombre || '';
    }

    normalizados.push({
      idSede: idSedeNum,
      nombre,
      fechaInicio: h.fechaInicio ? new Date(h.fechaInicio) : null,
      fechaFin: h.fechaFin ? new Date(h.fechaFin) : null,
    });
  }

  // Orden ASC por fechaInicio
  normalizados.sort((a, b) => {
    const ai = a.fechaInicio ? a.fechaInicio.getTime() : 0;
    const bi = b.fechaInicio ? b.fechaInicio.getTime() : 0;
    return ai - bi;
  });

  // Fusionar consecutivos con misma sede
  const fusionados = [];
  for (const item of normalizados) {
    const last = fusionados[fusionados.length - 1];
    if (last && last.idSede === item.idSede) {
      // extiende rango
      if (!last.fechaInicio || (item.fechaInicio && item.fechaInicio < last.fechaInicio)) {
        last.fechaInicio = item.fechaInicio;
      }
      // si item tiene fechaFin más reciente, úsala
      if (item.fechaFin && (!last.fechaFin || item.fechaFin > last.fechaFin)) {
        last.fechaFin = item.fechaFin;
      }
    } else {
      fusionados.push({ ...item });
    }
  }

  return fusionados;
};

// Normaliza y corrige historial **en base de datos**
const repairAndPersistHistorial = async (trabajador) => {
  if (!trabajador) return trabajador;

  // 1) Normaliza lo existente en memoria
  let hist = await normalizeHistorialArray(trabajador.historialSedes || []);

  // 2) Cierra múltiples abiertos si existieran (deja 1 abierto como máximo)
  const abiertosIdx = hist
    .map((h, idx) => (!h.fechaFin ? idx : -1))
    .filter(idx => idx !== -1);

  if (abiertosIdx.length > 1) {
    // cierra todos menos el último por fechaInicio
    abiertosIdx.slice(0, -1).forEach(i => {
      hist[i].fechaFin = new Date();
    });
  }

  // Recalcula abierto final
  const abierto = hist.find(h => !h.fechaFin) || null;

  // 3) Asegurar que haya un registro abierto para la sedePrincipal actual
  const principal = toNum(trabajador.sedePrincipal ?? trabajador.sede);
  if (principal !== null) {
    if (!abierto || abierto.idSede !== principal) {
      // cierra abierto existente
      if (abierto) abierto.fechaFin = new Date();

      // abre uno nuevo para la principal
      const sedeDoc = await Sede.findOne({ id: principal }).select('nombre');
      hist.push({
        idSede: principal,
        nombre: sedeDoc?.nombre || '',
        fechaInicio: new Date(),
        fechaFin: null,
      });
    }
  }

  // 4) Ordena y persiste
  hist.sort((a, b) => {
    const ai = a.fechaInicio ? a.fechaInicio.getTime() : 0;
    const bi = b.fechaInicio ? b.fechaInicio.getTime() : 0;
    return ai - bi;
  });

  trabajador.historialSedes = hist;
  await trabajador.save();
  return trabajador;
};

// =========================
// Controladores
// =========================

// 🔥 Obtener todos los trabajadores
const obtenerTrabajadores = async (_req, res) => {
  try {
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
      sede,
      sedePrincipal,
      sedesForaneas = [],
      correo, telefono, telefonoEmergencia, direccion, puesto,
      estado, sincronizado, fechaAlta,
      id_checador
    } = req.body;

    const principal = toNum(sedePrincipal ?? sede);
    if (!nombre || principal === null) {
      return res.status(400).json({ message: "Nombre y sede principal son requeridos" });
    }

    const sedeDoc = await Sede.findOne({ id: principal });
    const nombreSede = sedeDoc?.nombre || 'Desconocida';

    let nuevoIdChecador = id_checador ?? null;
    if (nuevoIdChecador === null || Number.isNaN(Number(nuevoIdChecador))) {
      const ultimo = await Trabajador.findOne().sort({ id_checador: -1 }).select('id_checador');
      nuevoIdChecador = (ultimo && !isNaN(ultimo.id_checador)) ? ultimo.id_checador + 1 : 100;
    }

    const foraneas = uniqNums(sedesForaneas).filter(id => id !== principal);
    const ahora = new Date();

    const nuevoTrabajador = new Trabajador({
      nombre: nombre.trim(),
      sede: principal,               // compat
      sedePrincipal: principal,
      sedesForaneas: foraneas,
      historialSedes: [{
        idSede: principal,
        nombre: nombreSede,
        fechaInicio: ahora,
        fechaFin: null
      }],
      id_checador: Number(nuevoIdChecador),
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

// ⚙️ Actualizar sede principal y sedes foráneas
const actualizarSedes = async (req, res) => {
  try {
    const { id } = req.params;
    let { sedePrincipal, sedesForaneas } = req.body;

    sedePrincipal = Number(sedePrincipal);
    if (!sedePrincipal || Number.isNaN(sedePrincipal)) {
      return res.status(400).json({ message: 'sedePrincipal inválida' });
    }

    sedesForaneas = Array.isArray(sedesForaneas)
      ? sedesForaneas
          .map(n => Number(n))
          .filter(n => !Number.isNaN(n) && n !== sedePrincipal)
      : [];

    const trabajador = await Trabajador.findById(id);
    if (!trabajador) {
      return res.status(404).json({ message: 'Trabajador no encontrado' });
    }

    const principalAnterior = toNum(trabajador.sedePrincipal ?? trabajador.sede);
    const cambioPrincipal = principalAnterior !== sedePrincipal;

    if (cambioPrincipal) {
      if (!Array.isArray(trabajador.historialSedes)) trabajador.historialSedes = [];
      trabajador.historialSedes.forEach(h => {
        if (!h.fechaFin) h.fechaFin = new Date();
      });

      const sedeDoc = await Sede.findOne({ id: sedePrincipal });
      trabajador.historialSedes.push({
        idSede: sedePrincipal,
        nombre: sedeDoc?.nombre || '',
        fechaInicio: new Date(),
        fechaFin: null
      });
    }

    trabajador.sede = sedePrincipal;            // compatibilidad
    trabajador.sedePrincipal = sedePrincipal;
    trabajador.sedesForaneas = [...new Set(sedesForaneas)];
    trabajador.sincronizado = false;

    const actualizado = await trabajador.save();
    res.status(200).json(actualizado);
  } catch (error) {
    console.error('❌ Error en actualizarSedes:', error);
    res.status(500).json({ message: 'Error al actualizar sedes' });
  }
};

// 🧰 Reparar/normalizar historial (persistente)
const repararHistorial = async (req, res) => {
  try {
    const { id } = req.params;
    const t = await Trabajador.findById(id);
    if (!t) return res.status(404).json({ message: 'Trabajador no encontrado' });

    await repairAndPersistHistorial(t);

    // Devuelve ya normalizado (y ordenado)
    const limpio = await normalizeHistorialArray(t.historialSedes);
    res.status(200).json({ message: 'Historial reparado', trabajador: { ...t.toObject(), historialSedes: limpio } });
  } catch (error) {
    console.error('❌ Error al reparar historial:', error);
    res.status(500).json({ message: 'Error al reparar historial' });
  }
};

// 🔒 Verificar contraseña del usuario
const verificarContraseña = async (req, res) => {
  try {
    const { contraseña } = req.body;
    const userId = req.user.id;
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

    // Normaliza historial solo para la respuesta (no persiste)
    const limpio = await normalizeHistorialArray(trabajador.historialSedes);
    const plain = trabajador.toObject();
    plain.historialSedes = limpio;

    res.status(200).json(plain);
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
      t.estado = 'inactivo';
      t.sincronizado = false;
      t.sedesForaneas = [];
      t.sede = null;
      t.sedePrincipal = null;

      const abierto = (t.historialSedes || []).find(h => !h.fechaFin);
      if (abierto) abierto.fechaFin = new Date();
    } else if (body.estado === 'activo') {
      t.estado = 'activo';
    }

    // ===== CAMBIO DE SEDE PRINCIPAL =====
    if (Object.prototype.hasOwnProperty.call(body, 'sede') ||
        Object.prototype.hasOwnProperty.call(body, 'sedePrincipal')) {

      const nuevaPrincipal = toNum(body.sedePrincipal ?? body.sede);

      if (nuevaPrincipal !== null && nuevaPrincipal !== t.sedePrincipal) {
        const abierto = (t.historialSedes || []).find(h => !h.fechaFin);
        if (abierto) abierto.fechaFin = new Date();

        const sedeDoc = await Sede.findOne({ id: nuevaPrincipal });
        const nombreSede = sedeDoc?.nombre || '';

        t.historialSedes = Array.isArray(t.historialSedes) ? t.historialSedes : [];
        t.historialSedes.push({
          idSede: nuevaPrincipal,
          nombre: nombreSede,
          fechaInicio: new Date(),
          fechaFin: null
        });

        t.sedePrincipal = nuevaPrincipal;
        t.sede = nuevaPrincipal;
        t.sincronizado = false;
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

    await t.save();

    // Devuelve historial normalizado
    const limpio = await normalizeHistorialArray(t.historialSedes);
    const plain = t.toObject();
    plain.historialSedes = limpio;

    res.status(200).json(plain);
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

// 🔁 Cambiar estado de sincronización
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
  actualizarSedes,
  repararHistorial,
};
