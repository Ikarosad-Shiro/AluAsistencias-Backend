const mongoose = require('mongoose');

const TrabajadorSchema = new mongoose.Schema({
    nombre: { type: String, required: true },
    sede: { type: Number, required: true },
    id_checador: { type: Number, required: true, unique: false },
    sincronizado: { type: Boolean, default: false },
    correo: { type: String, default: '' },  // 🆕 Nuevo campo
    telefono: { type: String, default: '' }, // 🆕 Nuevo campo
    telefonoEmergencia: { type: String, default: '' }, // 🆕 Nuevo campo
    direccion: { type: String, default: '' }, // 🆕 Nuevo campo
    puesto: { type: String, default: '' } // 🆕 Nuevo campo
});

module.exports = mongoose.model('Trabajador', TrabajadorSchema, 'trabajadores');
