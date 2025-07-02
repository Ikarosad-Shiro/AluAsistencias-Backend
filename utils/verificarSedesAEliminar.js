// utils/verificarSedesAEliminar.js
const Sede = require('../models/Sede');
const Trabajador = require('../models/Trabajador'); // 👈 Importa el modelo

async function verificarSedesAEliminar() {
  try {
    const hoy = new Date();
    const hace15Dias = new Date();
    hace15Dias.setDate(hoy.getDate() - 15);

    const sedesParaEliminar = await Sede.find({
      estado: 'eliminacion_pendiente',
      fechaEliminacionIniciada: { $lte: hace15Dias }
    });

    if (sedesParaEliminar.length > 0) {
      console.log(`🔎 Verificando sedes para eliminar: ${sedesParaEliminar.length}`);

      for (const sede of sedesParaEliminar) {
        console.log(`🗑️ Procesando eliminación de sede: ${sede.nombre}`);

        // 🔁 Buscar trabajadores asociados
        const trabajadores = await Trabajador.find({ sede: sede.id });

        for (const trabajador of trabajadores) {
          // Guardar historial y desactivar
          trabajador.estado = 'inactivo';
          trabajador.historialSedes = trabajador.historialSedes || [];

          trabajador.historialSedes.push({
            idSede: sede.id,
            nombre: sede.nombre,
            fechaFin: hoy
          });

          trabajador.sede = null; // 👈 Desasignar sede actual

          await trabajador.save();
        }

        // ✅ Ahora sí eliminar la sede
        await Sede.deleteOne({ _id: sede._id });

        console.log(`✅ Sede ${sede.nombre} eliminada y ${trabajadores.length} trabajadores actualizados.`);
      }
    } else {
      console.log('📭 No hay sedes pendientes por eliminar.');
    }
  } catch (error) {
    console.error('❌ Error al verificar sedes para eliminar:', error);
  }
}

module.exports = verificarSedesAEliminar;