// actualizarSedesAntiguas.js
require('dotenv').config();
const mongoose = require('mongoose');
const Sede = require('./models/Sede');

const MONGO_URI = process.env.MONGO_URI;

(async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Conectado a MongoDB');

    const resultado = await Sede.updateMany(
      { estado: { $exists: false } }, // Solo las sedes viejas que no tienen campo 'estado'
      {
        $set: {
          estado: 'activa',
          fechaEliminacionIniciada: null
        }
      }
    );

    console.log(`✅ Sedes actualizadas: ${resultado.modifiedCount}`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error al actualizar sedes:', error);
    process.exit(1);
  }
})();
