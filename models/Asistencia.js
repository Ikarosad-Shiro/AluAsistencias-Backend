const mongoose = require('mongoose');

const AsistenciaSchema = new mongoose.Schema({
    trabajador: { type: String, required: true },  // id_checador
    sede: { type: Number, required: true },
    fecha: { type: String, required: true },
    estado: { type: String, default: 'Pendiente' },
    detalle: [
        {
            tipo: { type: String, required: true },
            fechaHora: { type: Date, required: true },
            sincronizado: { type: Boolean, default: false },
            salida_automatica: { type: Boolean, default: false }
        }
    ]
});

module.exports = mongoose.model('Asistencia', AsistenciaSchema, 'asistencias');
