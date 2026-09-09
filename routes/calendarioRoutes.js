const express = require('express');
const router = express.Router();
const Calendario = require('../models/Calendario');
const Sede = require('../models/Sede');
const verifyToken = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/authMiddleware');

// ✅ Helpers de fecha robustos (usa la versión que te pasé)
const {
  toDay,                 // normaliza a mediodía UTC
  getSundaysInRange,     // devuelve domingos normalizados
  groupByYear,           // agrupa por año (UTC)
  toYmd,                 // Date/ISO/YMD -> 'YYYY-MM-DD'
  ymdToNoonUTC           // 'YYYY-MM-DD' -> Date 12:00Z
} = require('../utils/date');

const { v4: uuidv4 } = require('uuid'); // npm i uuid
// ======================================================
// 📅 Asegurar calendarios por sede para un año
// ======================================================
async function asegurarCalendariosDelAnio(anio) {
  const sedesActivas = await Sede.find(
    { estado: 'activa' },
    { id: 1, _id: 0 }
  ).lean();

  const idsSede = sedesActivas
    .map(s => Number(s.id))
    .filter(id => Number.isInteger(id));

  if (!idsSede.length) {
    return {
      totalSedes: 0,
      creados: 0
    };
  }

  const existentes = await Calendario.find(
    {
      año: anio,
      sedes: { $in: idsSede }
    },
    {
      sedes: 1
    }
  ).lean();

  const idsExistentes = new Set();

  for (const calendario of existentes) {
    for (const sedeId of calendario.sedes || []) {
      idsExistentes.add(Number(sedeId));
    }
  }

  const faltantes = idsSede.filter(
    id => !idsExistentes.has(id)
  );

  if (faltantes.length) {
    await Calendario.insertMany(
      faltantes.map(id => ({
        año: anio,
        sedes: [id],
        diasEspeciales: []
      }))
    );
  }

  return {
    totalSedes: idsSede.length,
    creados: faltantes.length
  };
}
// 💖 Ruta de prueba
router.get('/ping', (req, res) => {
  res.send('💖 ¡La ruta calendario está viva!');
});

// 🔍 Ver todos los calendarios
router.get('/todos', async (req, res) => {
  try {
    const calendarios = await Calendario.find();
    res.json(calendarios);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🔍 Obtener calendario por sede y año
/*router.get('/sede/:sede/anio/:anio', async (req, res) => {
  try {
    const anio = parseInt(req.params.anio);
    const sede = parseInt(req.params.sede);

    const calendario = await Calendario.findOne({
      año: anio,
      sedes: { $in: [sede] }
    });

    if (!calendario) {
      return res.status(404).json({ message: 'Calendario no encontrado para esta sede y año.' });
    }

    res.json(calendario);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});*/
// 🔍 Obtener calendario por sede y año
// Si faltan calendarios para ese año, los crea automáticamente.
router.get('/sede/:sede/anio/:anio', async (req, res) => {
  try {
    const anio = Number(req.params.anio);
    const sede = Number(req.params.sede);

    if (!Number.isInteger(anio) || !Number.isInteger(sede)) {
      return res.status(400).json({
        message: 'Año o sede inválidos.'
      });
    }

    // 📅 Crear calendarios faltantes para todas las sedes activas
    const resultado = await asegurarCalendariosDelAnio(anio);

    if (resultado.creados > 0) {
      console.log(
        `📅 Año ${anio}: se crearon ${resultado.creados} calendarios faltantes.`
      );
    }

    const calendario = await Calendario.findOne({
      año: anio,
      sedes: { $in: [sede] }
    });

    if (!calendario) {
      return res.status(404).json({
        message: 'Calendario no encontrado para esta sede y año.'
      });
    }

    return res.status(200).json(calendario);

  } catch (error) {
    console.error('❌ Error al obtener calendario:', error);

    return res.status(500).json({
      error: error.message
    });
  }
});
// ➕ Agregar un día especial (idempotente por YMD, guarda 12:00Z)
/*router.post('/agregar-dia', async (req, res) => {
  try {
    const { año, sede, fecha, tipo, descripcion, horaInicio, horaFin } = req.body;

    if (!año || !sede || !fecha || !tipo) {
      return res.status(400).json({ message: 'Faltan campos obligatorios.' });
    }

    const tiposValidos = [
      'festivo', 'puente', 'descanso',
      'media jornada', 'capacitación',
      'evento', 'suspensión'
    ];
    if (!tiposValidos.includes(tipo)) {
      return res.status(400).json({ message: `Tipo inválido. Debe ser uno de: ${tiposValidos.join(', ')}` });
    }

    // Normaliza a YYYY-MM-DD (estable)
    const fechaYmd = toYmd(fecha);

    // Trae/calienta el doc
    let calendario = await Calendario.findOne({ año, sedes: { $in: [sede] } });
    if (!calendario) {
      calendario = new Calendario({ año, sedes: [sede], diasEspeciales: [] });
    }

    // ¿Ya existe ese día? (comparación por YMD)
    const existe = (calendario.diasEspeciales || []).some(d => toYmd(d.fecha) === fechaYmd);
    if (existe) {
      // Usa 409 para que el front sepa que es duplicado (no error genérico)
      return res.status(409).json({ message: 'Ese día ya está configurado.' });
    }

    // Inserta como 12:00Z para evitar “corrimientos”
// Inserta como 12:00Z para evitar “corrimientos”
const nuevo = {
  fecha: ymdToNoonUTC(fechaYmd),
  tipo,
  descripcion: descripcion || ''
};

// ✅ Validación explícita de media jornada antes de guardar
if (tipo === 'media jornada') {
  const formatoHora = /^([01]\d|2[0-3]):[0-5]\d$/;

  if (!formatoHora.test(horaInicio || '') || !formatoHora.test(horaFin || '')) {
    return res.status(400).json({
      message: 'Media jornada requiere horaInicio y horaFin en formato HH:mm'
    });
  }

  nuevo.horaInicio = horaInicio;
  nuevo.horaFin = horaFin;
}


 //✅ Importante:
 //Usamos $push para agregar el día sin revalidar todo el arreglo diasEspeciales.
 // Esto evita que un registro viejo de media jornada sin horas bloquee el guardado.

if (calendario._id) {
  await Calendario.updateOne(
    { _id: calendario._id },
    { $push: { diasEspeciales: nuevo } }
  );

  const actualizado = await Calendario.findById(calendario._id);

  return res.status(201).json({
    message: 'Día especial agregado con éxito',
    calendario: actualizado
  });
}

// Si no existía calendario, creamos uno nuevo con el evento validado
const creado = await Calendario.create({
  año,
  sedes: [sede],
  diasEspeciales: [nuevo]
});

res.status(201).json({
  message: 'Día especial agregado con éxito',
  calendario: creado
});
  } catch (error) {
    console.error('❌ Error en /agregar-dia:', error);
    res.status(500).json({ error: error.message });
  }
});*/

// ✏️ Editar un día especial (match por YMD)
router.put('/editar-dia', async (req, res) => {
  try {
    const { año, sede, fecha, tipo, descripcion, horaInicio, horaFin } = req.body;

    if (!año || !sede || !fecha || !tipo) {
      return res.status(400).json({ message: 'Faltan campos obligatorios.' });
    }

    const calendario = await Calendario.findOne({ año, sedes: { $in: [sede] } });
    if (!calendario) {
      return res.status(404).json({ message: 'Calendario no encontrado.' });
    }

    const fechaYmd = toYmd(fecha);

    const dia = (calendario.diasEspeciales || []).find(d => toYmd(d.fecha) === fechaYmd);
    if (!dia) {
      return res.status(404).json({ message: 'Día no encontrado en el calendario.' });
    }

    // Actualiza campos
    dia.tipo = tipo;
    dia.descripcion = descripcion || '';

    if (tipo === 'media jornada') {
      dia.horaInicio = horaInicio ?? dia.horaInicio ?? null;
      dia.horaFin = horaFin ?? dia.horaFin ?? null;
    } else {
      // El pre('validate') del modelo limpia horas en otros tipos, pero por claridad:
      dia.horaInicio = null;
      dia.horaFin = null;
    }

    await calendario.save();
    res.json({ message: 'Día actualizado correctamente', calendario });
  } catch (error) {
    console.error('❌ Error en /editar-dia:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/agregar-dia', async (req, res) => {
  try {
    const {
      año,
      sede,
      fecha,
      tipo,
      descripcion,
      horaInicio,
      horaFin
    } = req.body;

    // ============================
    // VALIDACIONES BÁSICAS
    // ============================
    if (!año || !sede || !fecha || !tipo) {
      return res.status(400).json({
        message: 'Faltan campos obligatorios.'
      });
    }

    const anioNum = Number(año);
    const sedeNum = Number(sede);

    if (!Number.isInteger(anioNum) || !Number.isInteger(sedeNum)) {
      return res.status(400).json({
        message: 'Año o sede inválidos.'
      });
    }

    const tiposValidos = [
      'festivo',
      'puente',
      'descanso',
      'media jornada',
      'capacitación',
      'evento',
      'suspensión'
    ];

    if (!tiposValidos.includes(tipo)) {
      return res.status(400).json({
        message: `Tipo inválido. Debe ser uno de: ${tiposValidos.join(', ')}`
      });
    }

    // ============================
    // NORMALIZAR FECHA
    // ============================
    const fechaYmd = toYmd(fecha);

    if (!fechaYmd) {
      return res.status(400).json({
        message: 'Fecha inválida.'
      });
    }

    // ============================
    // BUSCAR CALENDARIO
    // ============================
    let calendario = await Calendario.findOne({
      año: anioNum,
      sedes: { $in: [sedeNum] }
    });

    // ============================
    // VALIDAR DUPLICADO
    // ============================
    if (calendario) {
      const existe = (calendario.diasEspeciales || []).some(
        d => toYmd(d.fecha) === fechaYmd
      );

      if (existe) {
        return res.status(409).json({
          message: 'Ese día ya está configurado.'
        });
      }
    }

    // ============================
    // CREAR NUEVO EVENTO
    // ============================
    const nuevo = {
      fecha: ymdToNoonUTC(fechaYmd),
      tipo,
      descripcion: descripcion || ''
    };

    if (tipo === 'media jornada') {
      const formatoHora = /^([01]\d|2[0-3]):[0-5]\d$/;

      if (
        !formatoHora.test(horaInicio || '') ||
        !formatoHora.test(horaFin || '')
      ) {
        return res.status(400).json({
          message:
            'Media jornada requiere horaInicio y horaFin en formato HH:mm'
        });
      }

      nuevo.horaInicio = horaInicio;
      nuevo.horaFin = horaFin;
    }

    // ==================================================
    // SI NO EXISTE CALENDARIO, CREARLO
    // ==================================================
    if (!calendario) {
      console.log(
        `🆕 Creando calendario ${anioNum} para sede ${sedeNum}`
      );

      calendario = await Calendario.create({
        año: anioNum,
        sedes: [sedeNum],
        diasEspeciales: [nuevo]
      });

      return res.status(201).json({
        message: 'Calendario creado y día especial agregado con éxito',
        calendario
      });
    }

    // ==================================================
    // SI YA EXISTE, SOLO AGREGAR EL EVENTO
    // Usamos $push para no revalidar todo el histórico
    // ==================================================
    const resultado = await Calendario.updateOne(
      { _id: calendario._id },
      {
        $push: {
          diasEspeciales: nuevo
        }
      }
    );

    if (resultado.matchedCount !== 1) {
      return res.status(500).json({
        message: 'No se pudo actualizar el calendario.'
      });
    }

    const actualizado = await Calendario.findById(calendario._id);

    return res.status(201).json({
      message: 'Día especial agregado con éxito',
      calendario: actualizado
    });

  } catch (error) {
    console.error('❌ Error en /agregar-dia:', error);

    return res.status(500).json({
      error: error.message
    });
  }
});
// ❌ Eliminar un día especial (match por YMD)
router.delete('/eliminar-dia', async (req, res) => {
  try {
    const { año, sede, fecha } = req.body;

    const calendario = await Calendario.findOne({ año, sedes: { $in: [sede] } });
    if (!calendario) return res.status(404).json({ message: 'Calendario no encontrado.' });

    const fechaYmd = toYmd(fecha);

    const cantidadAntes = (calendario.diasEspeciales || []).length;
    calendario.diasEspeciales = (calendario.diasEspeciales || []).filter(d => toYmd(d.fecha) !== fechaYmd);
    const cantidadDespues = calendario.diasEspeciales.length;

    if (cantidadAntes === cantidadDespues) {
      return res.status(404).json({ message: 'Día no encontrado para eliminar.' });
    }

    await calendario.save();
    res.json({ message: 'Día eliminado del calendario', calendario });
  } catch (error) {
    console.error('❌ Error al eliminar día:', error);
    res.status(500).json({ error: error.message });
  }
});

// ======================================================
// 🕊️ PREVIEW ASISTENTE DE DOMINGO
// ======================================================
router.post(
  '/asistente-domingo/preview',
  verifyToken,
  requireRole(['Administrador', 'Dios']),
  async (req, res) => {
    try {
      const {
        sedeIds = [],
        inicio,
        fin
      } = req.body || {};

      // ============================
      // VALIDACIONES
      // ============================
      if (!Array.isArray(sedeIds) || !sedeIds.length) {
        return res.status(400).json({
          message: 'sedeIds requerido'
        });
      }

      if (!inicio || !fin) {
        return res.status(400).json({
          message: 'inicio/fin requeridos'
        });
      }

      const start = toDay(inicio);
      const end = toDay(fin);

      // ============================
      // LÍMITES DE SEGURIDAD
      // ============================
      const maxDays = 370;
      const maxAsignaciones = 1000;

      const diffDays =
        Math.ceil((end - start) / 86400000) + 1;

      if (diffDays > maxDays) {
        return res.status(400).json({
          message:
            `Rango demasiado grande (>${maxDays} días)`
        });
      }

      // ============================
      // OBTENER DOMINGOS
      // ============================
      const domingos = getSundaysInRange(
        start,
        end
      );

      // ============================
      // PROTECCIÓN POR VOLUMEN
      // ============================
      const totalAsignaciones =
        domingos.length * sedeIds.length;

      if (totalAsignaciones > maxAsignaciones) {
        return res.status(400).json({
          message:
            `Demasiadas asignaciones (${totalAsignaciones}). ` +
            'Reduce el rango o la cantidad de sedes.'
        });
      }

      if (!domingos.length) {
        return res.json({
          totalDomingos: 0,
          aCrear: 0,
          conEvento: 0,
          sedesProcesadas: sedeIds.length,
          detalle: []
        });
      }

      // ============================
      // AGRUPAR POR AÑO
      // ============================
      const porAño = groupByYear(domingos);
      const años = Object.keys(porAño).map(Number);

      // ============================
      // BUSCAR CALENDARIOS
      // ============================
      const docs = await Calendario.find(
        {
          año: { $in: años },
          sedes: { $in: sedeIds }
        },
        {
          año: 1,
          sedes: 1,
          diasEspeciales: 1
        }
      ).lean();

      // year|sede -> Set('YYYY-MM-DD')
      const existing = new Map();

      for (const doc of docs) {
        const fechasSet = new Set(
          (doc.diasEspeciales || []).map(
            e => toYmd(e.fecha)
          )
        );

        for (const sede of doc.sedes) {
          existing.set(
            `${doc.año}|${sede}`,
            fechasSet
          );
        }
      }

      // ============================
      // GENERAR PREVIEW
      // ============================
      let aCrear = 0;
      let conEvento = 0;

      const detalle = [];

      for (const sede of sedeIds) {
        for (const domingo of domingos) {
          const ymd = toYmd(domingo);

          const set = existing.get(
            `${domingo.getUTCFullYear()}|${sede}`
          );

          if (set && set.has(ymd)) {
            conEvento++;

            detalle.push({
              sede,
              fechaYmd: ymd,
              motivo: 'ocupado'
            });
          } else {
            aCrear++;

            detalle.push({
              sede,
              fechaYmd: ymd,
              motivo: 'crear'
            });
          }
        }
      }

      // ============================
      // RESPUESTA
      // ============================
      return res.json({
        totalDomingos:
          domingos.length * sedeIds.length,
        aCrear,
        conEvento,
        sedesProcesadas: sedeIds.length,
        detalle
      });

    } catch (error) {
      console.error(
        '❌ Error en preview asistente domingo:',
        error
      );

      return res.status(500).json({
        message: error.message
      });
    }
  }
);


// ======================================================
// ✅ APPLY ASISTENTE DE DOMINGO
// ======================================================
router.post(
  '/asistente-domingo/apply',
  verifyToken,
  requireRole(['Administrador', 'Dios']),
  async (req, res) => {
    try {
      const {
        sedeIds = [],
        inicio,
        fin,
        descripcion = 'Asistente de Domingo'
      } = req.body || {};

      const user = req.user || {};

      // ============================
      // VALIDACIONES
      // ============================
      if (!Array.isArray(sedeIds) || !sedeIds.length) {
        return res.status(400).json({
          message: 'sedeIds requerido'
        });
      }

      if (!inicio || !fin) {
        return res.status(400).json({
          message: 'inicio/fin requeridos'
        });
      }

      const start = toDay(inicio);
      const end = toDay(fin);

      // ============================
      // LÍMITES DE SEGURIDAD
      // ============================
      const maxDays = 370;
      const maxAsignaciones = 1000;

      const diffDays =
        Math.ceil((end - start) / 86400000) + 1;

      if (diffDays > maxDays) {
        return res.status(400).json({
          message:
            `Rango demasiado grande (>${maxDays} días)`
        });
      }

      // ============================
      // OBTENER DOMINGOS
      // ============================
      const domingos = getSundaysInRange(
        start,
        end
      );

      // ============================
      // PROTECCIÓN POR VOLUMEN
      // ============================
      const totalAsignaciones =
        domingos.length * sedeIds.length;

      if (totalAsignaciones > maxAsignaciones) {
        return res.status(400).json({
          message:
            `Demasiadas asignaciones (${totalAsignaciones}). ` +
            'Reduce el rango o la cantidad de sedes.'
        });
      }

      if (!domingos.length) {
        return res.json({
          batchId: null,
          created: 0,
          skipped: 0
        });
      }

      // ============================
      // DATOS DEL LOTE
      // ============================
      const batchId = uuidv4();

      const autor =
        user?.email ||
        user?._id ||
        'system';

      const porAño = groupByYear(domingos);

      let created = 0;
      let skipped = 0;

      // ============================
      // PROCESAR CADA AÑO
      // ============================
      for (
        const [añoStr, fechas]
        of Object.entries(porAño)
      ) {
        const año = Number(añoStr);

        // Buscar calendarios existentes
        const docs = await Calendario.find(
          {
            año,
            sedes: { $in: sedeIds }
          },
          {
            año: 1,
            sedes: 1,
            diasEspeciales: 1
          }
        ).lean();

        // sede -> calendario
        const docBySede = new Map();

        for (const doc of docs) {
          for (const sede of doc.sedes) {
            docBySede.set(sede, doc);
          }
        }

        // ============================
        // PROCESAR CADA SEDE
        // ============================
        for (const sede of sedeIds) {
          const doc = docBySede.get(sede);

          const existentesSet = new Set(
            (doc?.diasEspeciales || []).map(
              e => toYmd(e.fecha)
            )
          );

          // Fechas candidatas
          const candidatosYmd = fechas.map(
            fecha => toYmd(fecha)
          );

          // Solo agregar las que no existen
          const faltantesYmd =
            candidatosYmd.filter(
              ymd => !existentesSet.has(ymd)
            );

          // Si todas ya existen
          if (!faltantesYmd.length) {
            skipped += candidatosYmd.length;
            continue;
          }

          // ============================
          // CREAR EVENTOS
          // ============================
          const nuevos = faltantesYmd.map(
            ymd => ({
              fecha: ymdToNoonUTC(ymd),
              tipo: 'descanso',
              descripcion,
              source: 'asistente-domingo',
              batchId,
              createdBy: autor,
              createdAt: new Date()
            })
          );

          // ============================
          // SI EXISTE CALENDARIO
          // ============================
          if (doc) {
            await Calendario.updateOne(
              {
                _id: doc._id
              },
              {
                $push: {
                  diasEspeciales: {
                    $each: nuevos
                  }
                }
              }
            );
          }

          // ============================
          // SI NO EXISTE CALENDARIO
          // ============================
          else {
            await Calendario.create({
              año,
              sedes: [sede],
              diasEspeciales: nuevos
            });
          }

          created += nuevos.length;

          skipped +=
            candidatosYmd.length -
            nuevos.length;
        }
      }

      // ============================
      // RESPUESTA
      // ============================
      return res.json({
        batchId,
        created,
        skipped
      });

    } catch (error) {
      console.error(
        '❌ Error en apply asistente domingo:',
        error
      );

      return res.status(500).json({
        message: error.message
      });
    }
  }
);

// 🔙 UNDO por batchId
router.post('/asistente-domingo/undo',
  verifyToken, requireRole(['Administrador', 'Dios']),
  async (req, res) => {
    try {
      const { batchId } = req.body || {};
      if (!batchId) return res.status(400).json({ message: 'batchId requerido' });

      const r = await Calendario.updateMany(
        {},
        { $pull: { diasEspeciales: { source: 'asistente-domingo', batchId } } }
      );

      res.json({ modifiedCount: r.modifiedCount });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  }
);

module.exports = router;
