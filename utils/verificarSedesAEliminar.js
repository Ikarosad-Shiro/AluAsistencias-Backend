// utils/verificarSedesAEliminar.js
const Sede = require('../models/Sede');

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
        // Aquí en Fase 2 también se desactivarán trabajadores
        console.log(`🗑️ Eliminando sede: ${sede.nombre}`);
        await Sede.deleteOne({ _id: sede._id });
      }

      console.log(`✅ Sedes eliminadas: ${sedesParaEliminar.length}`);
    } else {
      console.log('📭 No hay sedes pendientes por eliminar.');
    }
  } catch (error) {
    console.error('❌ Error al verificar sedes para eliminar:', error);
  }
}

module.exports = verificarSedesAEliminar;
