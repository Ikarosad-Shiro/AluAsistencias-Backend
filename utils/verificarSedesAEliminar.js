// utils/verificarSedesAEliminar.js
const Sede = require('../models/Sede');
const Trabajador = require('../models/Trabajador'); // 👈 Importa el modelo

async function verificarSedesAEliminar() {
  try {
    const hoy = new Date();
    const hace15Dias = new Date();
    hace15Dias.setDate(hoy.getDate() - 15);

    console.log('🧠 Ejecutando verificación de sedes...');
    console.log('📅 Hoy es:', hoy.toISOString());
    console.log('📅 Se eliminarán sedes marcadas antes de:', hace15Dias.toISOString());

    const sedesParaEliminar = await Sede.find({
      estado: 'eliminacion_pendiente',
      fechaEliminacionIniciada: { $lte: hace15Dias }
    });

    console.log(`🔍 Sedes encontradas con eliminación_pendiente + fecha válida: ${sedesParaEliminar.length}`);

    if (sedesParaEliminar.length > 0) {
      for (const sede of sedesParaEliminar) {
        console.log(`🗑️ Procesando eliminación de sede: ${sede.nombre}`);

        const trabajadores = await Trabajador.find({ sede: sede.id });

        for (const trabajador of trabajadores) {
          trabajador.estado = 'inactivo';
          trabajador.historialSedes = trabajador.historialSedes || [];

          trabajador.historialSedes.push({
            idSede: sede.id,
            nombre: sede.nombre,
            fechaFin: hoy
          });

          trabajador.sede = null;

          await trabajador.save();
        }

        await Sede.deleteOne({ _id: sede._id });

        console.log(`✅ Sede ${sede.nombre} eliminada y ${trabajadores.length} trabajadores actualizados.`);
      }
    } else {
      console.log('📭 No hay sedes para eliminar en este momento.');
    }
  } catch (error) {
    console.error('❌ Error al verificar sedes para eliminar:', error);
  }
}

module.exports = verificarSedesAEliminar;