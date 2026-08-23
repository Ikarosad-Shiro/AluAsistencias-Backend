/*const mongoose = require('mongoose');

 const AsistenciaSchema = new mongoose.Schema({
  trabajador: {
    type: String,         // ID del trabajador (id_checador)
    required: true
  },
  sede: {
    type: Number,         // ID de la sede
    required: true
  },
  fecha: {
    type: String,         // Formato: 'YYYY-MM-DD' como string
    required: true
  },
  estado: {
    type: String,         // Ej: 'Asistencia Completa', 'Falta', 'Pendiente'
    default: 'Pendiente'
  },
  detalle: [
    {
      trabajador: {
        type: String,    // ← ¡Agrega esto!
        required: true
      },
      tipo: {
        type: String,
        required: true
      },
      fechaHora: {
        type: String,
        required: true
      },
      sincronizado: {
        type: Boolean,
        default: false
      },
      salida_automatica: {
        type: Boolean,
        default: false
      }
    }
  ]  
});

module.exports = mongoose.model('Asistencia', AsistenciaSchema, 'asistencias');*/
/*--------------------------------------------------------------------------------- */
// models/Asistencia.js
const mongoose = require('mongoose');

/**
 * Este modelo queda compatible con:
 *
 * FORMATO VIEJO:
 * detalle: [
 *   { tipo: 'Entrada', fechaHora: '...', ... },
 *   { tipo: 'Salida', fechaHora: '...', ... }
 * ]
 *
 * FORMATO NUEVO DEL SERVIDOR LOCAL:
 * primerRegistro: { fechaHora: '...' }
 * ultimoRegistro: { fechaHora: '...' }
 * totalRegistros: 5
 * registros: [
 *   { fechaHora: '...', origen: 'checador', device_ip: '...' }
 * ]
 */

const RegistroSchema = new mongoose.Schema({
  fechaHora: {
    type: String,
    required: true
  },
  tipo: {
    type: String,
    default: 'Registro'
  },
  sede: {
    type: Number,
    default: null
  },
  device_ip: {
    type: String,
    default: ''
  },
  origen: {
    type: String,
    default: 'checador'
  },
  uid: {
    type: String,
    default: ''
  },
  user_id: {
    type: String,
    default: ''
  },
  sincronizado: {
    type: Boolean,
    default: false
  },
  salida_automatica: {
    type: Boolean,
    default: false
  }
}, { _id: false });

const AsistenciaSchema = new mongoose.Schema({
  trabajador: {
    type: String, // id_checador del trabajador
    required: true,
    index: true
  },

  sede: {
    type: Number, // ID de la sede
    required: true,
    index: true
  },

  fecha: {
    type: String, // YYYY-MM-DD
    required: true,
    index: true
  },

  /**
   * Campo legado.
   * Se conserva para no romper información anterior.
   */
  estado: {
    type: String,
    default: 'Pendiente'
  },

  /**
   * FORMATO VIEJO
   */
  detalle: [
    {
      trabajador: {
        type: String,
        default: ''
      },
      tipo: {
        type: String,
        required: true
      },
      fechaHora: {
        type: String,
        required: true
      },
      sede: {
        type: Number,
        default: null
      },
      sincronizado: {
        type: Boolean,
        default: false
      },
      salida_automatica: {
        type: Boolean,
        default: false
      }
    }
  ],

  /**
   * FORMATO NUEVO
   */
  primerRegistro: {
    fechaHora: {
      type: String,
      default: ''
    },
    sede: {
      type: Number,
      default: null
    },
    device_ip: {
      type: String,
      default: ''
    },
    origen: {
      type: String,
      default: 'checador'
    }
  },

  ultimoRegistro: {
    fechaHora: {
      type: String,
      default: ''
    },
    sede: {
      type: Number,
      default: null
    },
    device_ip: {
      type: String,
      default: ''
    },
    origen: {
      type: String,
      default: 'checador'
    }
  },

  totalRegistros: {
    type: Number,
    default: 0
  },

  registros: {
    type: [RegistroSchema],
    default: []
  }
}, {
  timestamps: true,
  collection: 'asistencias'
});

/**
 * Índice útil para que no se dupliquen asistencias consolidadas
 * del mismo trabajador, sede y fecha.
 *
 * OJO:
 * Si ya existieran duplicados en MongoDB, este índice podría fallar.
 * Por eso lo dejamos comentado por seguridad.
 *
 * Después, cuando validemos datos, podemos activarlo.
 */
// AsistenciaSchema.index({ trabajador: 1, sede: 1, fecha: 1 }, { unique: true });

AsistenciaSchema.index({ trabajador: 1, fecha: 1 });
AsistenciaSchema.index({ sede: 1, fecha: 1 });
AsistenciaSchema.index({ trabajador: 1, sede: 1, fecha: 1 });

module.exports = mongoose.model('Asistencia', AsistenciaSchema);
