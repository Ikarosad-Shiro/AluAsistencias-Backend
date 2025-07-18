const Trabajador = require('../models/Trabajador'); // Modelo de Trabajador
const bcrypt = require('bcryptjs');
const User = require('../models/User'); // Modelo de Usuario para verificación de contraseña
const Asistencia = require('../models/Asistencia'); // 📌 Asegúrate de tener el modelo Asistencia
const Sede = require('../models/Sede');

// 🔥 Obtener todos los trabajadores
const obtenerTrabajadores = async (req, res) => {
    try {
        const trabajadores = await Trabajador.find({}, '_id nombre sede id_checador sincronizado estado'); // Incluir id_checador
        res.status(200).json(trabajadores);
    } catch (error) {
        console.error("❌ Error al obtener trabajadores:", error);
        res.status(500).json({ message: "Error al obtener trabajadores" });
    }
};

// 🔥 Agregar un nuevo trabajador con ID de checador único y consecutivo
const agregarTrabajador = async (req, res) => {
    try {
      const { nombre, sede } = req.body;
  
      if (!nombre || !sede) {
        return res.status(400).json({ message: "Nombre y sede son requeridos" });
      }
  
      const sedeNumero = Number(sede);
      if (isNaN(sedeNumero)) {
        return res.status(400).json({ message: "Sede inválida" });
      }
  
      // 🧠 Obtener el nombre de la sede para historial
      const sedeDoc = await Sede.findOne({ id: sedeNumero });
      const nombreSede = sedeDoc?.nombre || 'Desconocida';
  
      // ✅ Buscar último ID global
      const ultimoTrabajadorGlobal = await Trabajador.findOne()
        .sort({ id_checador: -1 })
        .select("id_checador");
  
      const nuevoIdChecador = (ultimoTrabajadorGlobal && !isNaN(ultimoTrabajadorGlobal.id_checador))
        ? ultimoTrabajadorGlobal.id_checador + 1
        : 100;
  
      const ahora = new Date();
  
      // 📦 Crear el nuevo trabajador con historial
      const nuevoTrabajador = new Trabajador({
        nombre,
        sede: sedeNumero,
        id_checador: nuevoIdChecador,
        sincronizado: false,
        estado: 'activo',
        historialSedes: [{
          idSede: sedeNumero.toString(),
          nombre: nombreSede,
          fechaInicio: ahora,
          fechaFin: null
        }]
      });
  
      await nuevoTrabajador.save();
      res.status(201).json({ message: "Trabajador agregado correctamente", trabajador: nuevoTrabajador });
  
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

// 🔥 Verificar la contraseña del usuario antes de eliminar
const verificarContraseña = async (req, res) => {
    try {
        const { contraseña } = req.body;
        const userId = req.user.id; // Se obtiene del token de autenticación
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }

        const contraseñaValida = await bcrypt.compare(contraseña, user.password);
        if (!contraseñaValida) {
            return res.status(401).json({ message: 'Contraseña incorrecta' });
        }

        res.status(200).json(true);
    } catch (error) {
        console.error('❌ Error al verificar contraseña:', error);
        res.status(500).json({ message: 'Error al verificar contraseña' });
    }
};

//----------------trabajador en particual---------------------------------
// 🔥 Obtener un trabajador específico por ID
const obtenerTrabajadorPorId = async (req, res) => {
    try {
        const { id } = req.params;
        const trabajador = await Trabajador.findById(id);

        if (!trabajador) {
            return res.status(404).json({ message: 'Trabajador no encontrado' });
        }

        res.status(200).json(trabajador);
    } catch (error) {
        console.error('❌ Error al obtener trabajador por ID:', error);
        res.status(500).json({ message: 'Error al obtener trabajador' });
    }
};

// 🔄 Actualizar un trabajador (incluye sede, estado, sincronizado, historial, etc.)
const actualizarTrabajador = async (req, res) => {
    try {
      const { id } = req.params;
      const {
        nombre,
        sede,
        correo,
        telefono,
        telefonoEmergencia,
        direccion,
        puesto,
        estado, // ✅ Nuevos campos aceptados
        sincronizado,
        historialSedes
      } = req.body;
  
      const trabajadorActualizado = await Trabajador.findByIdAndUpdate(
        id,
        { nombre,
          sede,
          correo,
          telefono,
          telefonoEmergencia,
          direccion,
          puesto,
          estado,
          sincronizado,
          historialSedes
        },
        { new: true }
      );
  
      if (!trabajadorActualizado) {
        return res.status(404).json({ message: 'Trabajador no encontrado' });
      }
  
      res.status(200).json(trabajadorActualizado);
    } catch (error) {
      console.error('❌ Error al actualizar trabajador:', error);
      res.status(500).json({ message: 'Error al actualizar trabajador' });
    }
  };  

// 🔥 Obtener asistencias de un trabajador específico usando id_checador y sede
const obtenerAsistencias = async (req, res) => {
    try {
        const { id } = req.params;
        
        // 🟢 Obtener el trabajador usando el ID de MongoDB
        const trabajador = await Trabajador.findById(id);
        if (!trabajador) {
            return res.status(404).json({ message: 'Trabajador no encontrado' });
        }

        // 🟢 Buscar asistencias usando id_checador y sede
        const asistencias = await Asistencia.find({
            trabajador: trabajador.id_checador,  // Buscar por id_checador
            sede: trabajador.sede                // Y por sede
        });

        res.status(200).json(asistencias);
    } catch (error) {
        console.error('❌ Error al obtener asistencias:', error);
        res.status(500).json({ message: 'Error al obtener asistencias' });
    }
};

const actualizarEstadoSincronizacion = async (req, res) => {
  try {
    const { id } = req.params;
    const { sincronizado } = req.body;

    const trabajador = await Trabajador.findById(id);
    if (!trabajador) return res.status(404).json({ message: 'Trabajador no encontrado' });

    trabajador.sincronizado = sincronizado;
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
