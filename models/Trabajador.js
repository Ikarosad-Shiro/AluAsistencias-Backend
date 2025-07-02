const mongoose = require('mongoose');

const TrabajadorSchema = new mongoose.Schema({
    nombre: { type: String, required: true },
    sede: { type: Number, required: false, default: null },
    id_checador: { type: Number, required: true, unique: false },
    sincronizado: { type: Boolean, default: false },
    correo: { type: String, default: '' },  // 🆕 Nuevo campo
    telefono: { type: String, default: '' }, // 🆕 Nuevo campo
    telefonoEmergencia: { type: String, default: '' }, // 🆕 Nuevo campo
    direccion: { type: String, default: '' }, // 🆕 Nuevo campo
    puesto: { type: String, default: '' }, // 🆕 Nuevo campo
    estado: { type: String, enum: ["activo", "inactivo"], default: "activo" },
    historialSedes: [{ idSede: String, nombre: String, fechaInicio: Date, fechaFin: Date }]
});

module.exports = mongoose.model('Trabajador', TrabajadorSchema, 'trabajadores');
