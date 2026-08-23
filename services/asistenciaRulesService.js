// services/asistenciaRulesService.js

const { DateTime } = require('luxon');

const ZONE = 'America/Mexico_City';


/**
 * Detecta si un string ISO trae zona horaria explícita:
 * Z, -06:00, +00:00, etc.
 */
function tieneZonaHoraria(value) {
  return (
    typeof value === 'string' &&
    /([zZ]|[+-]\d{2}:?\d{2})$/.test(value.trim())
  );
}


/**
 * Parsea fechas de forma segura para CDMX.
 *
 * Si viene con zona horaria:
 *   2026-05-11T08:00:00-06:00
 *   2026-05-11T14:00:00Z
 *
 * Se respeta y se convierte a CDMX.
 *
 * Si viene sin zona horaria:
 *   2026-05-11T08:00:00
 *
 * Se interpreta como hora local de CDMX, no como UTC.
 */
function parseDateTimeMX(value) {
  if (!value) return null;

  if (typeof value === 'string') {
    const clean = value.trim();

    if (tieneZonaHoraria(clean)) {
      return DateTime
        .fromISO(clean, { setZone: true })
        .setZone(ZONE);
    }

    return DateTime.fromISO(
      clean,
      { zone: ZONE }
    );
  }

  return DateTime
    .fromJSDate(new Date(value))
    .setZone(ZONE);
}


/**
 * Convierte cualquier fecha a YYYY-MM-DD
 * en horario CDMX.
 */
function dayMX(value) {
  const dt = parseDateTimeMX(value);

  return dt?.isValid
    ? dt.toISODate()
    : '';
}


/**
 * Convierte cualquier fecha/hora a HH:mm
 * en horario CDMX.
 */
function timeMX(value) {
  const dt = parseDateTimeMX(value);

  return dt?.isValid
    ? dt.toFormat('HH:mm')
    : '';
}


/**
 * Convierte HH:mm a minutos.
 */
function toMinutes(hhmm) {
  if (
    !hhmm ||
    !String(hhmm).includes(':')
  ) {
    return null;
  }

  const [h, m] =
    String(hhmm)
      .split(':')
      .map(Number);

  if (
    Number.isNaN(h) ||
    Number.isNaN(m)
  ) {
    return null;
  }

  return (h * 60) + m;
}


/**
 * Convierte texto para comparar
 * sin problemas de mayúsculas,
 * espacios o acentos.
 */
function normalizarTexto(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}


/**
 * Detecta si la sede debe usar horario
 * de oficina.
 *
 * Por ahora:
 * - Sede 1 = Administración V.C / Oficina
 * - También detecta por nombre si contiene
 *   administración/oficina.
 */
function esSedeOficina(sede) {
  if (!sede) {
    return false;
  }

  const idSede =
    Number(
      sede.id ??
      sede.sede ??
      sede
    );

  const nombre =
    normalizarTexto(
      sede.nombre || ''
    );

  return (
    idSede === 1 ||
    nombre.includes('administracion') ||
    nombre.includes('oficina')
  );
}


/**
 * Obtiene el horario laboral
 * de una fecha para una sede.
 *
 * Primero intenta usar sede.horarioBase
 * si existe.
 *
 * Si no existe, usa reglas por defecto:
 *
 * Oficina:
 *   L-V 09:00-18:00
 *   Sábado 09:00-15:00
 *   Domingo descanso
 *
 * Demás sedes:
 *   L-V 08:00-18:00
 *   Sábado 08:00-15:00
 *   Domingo descanso
 */
function obtenerHorarioLaboral(
  fechaStr,
  sedeDoc
) {
  const dt =
    DateTime.fromISO(
      fechaStr,
      { zone: ZONE }
    );

  // Luxon:
  // lunes=1 ... domingo=7
  //
  // Nuestro modelo Sede:
  // domingo=0 ... sábado=6
  const dow =
    dt.weekday % 7;


  // =====================================================
  // 1. HORARIO CONFIGURADO EN LA SEDE
  // =====================================================

  if (
    sedeDoc?.horarioBase?.reglas?.length
  ) {
    const desde =
      sedeDoc.horarioBase.desde
        ? DateTime
            .fromJSDate(
              new Date(
                sedeDoc.horarioBase.desde
              )
            )
            .setZone(ZONE)
            .startOf('day')
        : null;

    const fecha =
      dt.startOf('day');

    if (
      !desde ||
      fecha >= desde
    ) {
      const regla =
        sedeDoc.horarioBase.reglas.find(
          (r) =>
            Number(r.dow) === Number(dow)
        );

      if (
        regla &&
        regla.jornadas &&
        regla.jornadas.length > 0
      ) {
        const jornada =
          regla.jornadas[0];

        return {
          esLaboral: true,

          tipoJornada:
            dow === 6
              ? 'medio_turno'
              : 'normal',

          entradaEsperada:
            jornada.ini,

          salidaEsperada:
            jornada.fin,

          fuente:
            'horarioBase'
        };
      }
    }
  }


  // =====================================================
  // 2. FALLBACK POR DEFECTO
  // =====================================================

  const oficina =
    esSedeOficina(sedeDoc);


  // Domingo
  if (dow === 0) {
    return {
      esLaboral: false,

      tipoJornada:
        'descanso',

      entradaEsperada:
        null,

      salidaEsperada:
        null,

      fuente:
        'default'
    };
  }


  // Sábado
  if (dow === 6) {
    return {
      esLaboral: true,

      tipoJornada:
        'medio_turno',

      entradaEsperada:
        oficina
          ? '09:00'
          : '08:00',

      salidaEsperada:
        '15:00',

      fuente:
        'default'
    };
  }


  // Lunes a viernes
  return {
    esLaboral: true,

    tipoJornada:
      'normal',

    entradaEsperada:
      oficina
        ? '09:00'
        : '08:00',

    salidaEsperada:
      '18:00',

    fuente:
      'default'
  };
}


/**
 * Extrae entrada/salida
 * de un grupo de asistencias de un día.
 *
 * Compatible con:
 *
 * - Formato viejo:
 *   detalle[] con tipo Entrada / Salida
 *
 * - Formato nuevo:
 *   primerRegistro
 *   ultimoRegistro
 *   totalRegistros
 *   registros[]
 *
 *
 * REGLA MULTISEDE:
 *
 * Para el formato nuevo se juntan TODAS
 * las marcas del trabajador del día,
 * sin importar en qué sede fueron hechas.
 *
 * Primera marca global = Entrada
 * Última marca global  = Salida
 *
 * Si solo existe una marca global:
 * Entrada sin salida.
 */
function extraerMarcasDelDia(
  asistencias = [],
  fechaStr
) {
  const sedesDia =
    new Set();

  const marcasNuevas = [];

  /*
   * Para datos históricos detalle[],
   * conservamos sus tipos Entrada / Salida.
   */
  const entradasLegacy = [];
  const salidasLegacy = [];

  /*
   * Evita duplicar una misma marca.
   */
  const marcasUnicas =
    new Set();

  let totalRegistros = 0;
  let usoFormatoNuevo = false;


  // =====================================================
  // HELPER: FECHA A MILISEGUNDOS
  // =====================================================

  const getMillis = (value) => {
    const dt =
      parseDateTimeMX(value);

    return dt?.isValid
      ? dt.toMillis()
      : null;
  };


  // =====================================================
  // HELPER: AGREGAR SEDE
  // =====================================================

  const agregarSede = (sede) => {
    if (sede != null) {
      sedesDia.add(sede);
    }
  };


  // =====================================================
  // HELPER: CLAVE PARA EVITAR DUPLICADOS
  // =====================================================

  const crearClave = (
    reg,
    sede
  ) => {
    const millis =
      getMillis(
        reg?.fechaHora
      );

    if (millis == null) {
      return null;
    }

    return (
      `${millis}|${sede ?? ''}`
    );
  };


  // =====================================================
  // HELPER: AGREGAR MARCA FORMATO NUEVO
  // =====================================================

  const agregarMarcaNueva = (
    reg,
    sedeFallback = null
  ) => {
    if (!reg?.fechaHora) {
      return;
    }

    /*
     * Solo registros del día solicitado.
     */
    if (
      dayMX(reg.fechaHora) !== fechaStr
    ) {
      return;
    }

    const sede =
      reg.sede ??
      sedeFallback ??
      null;

    const clave =
      crearClave(
        reg,
        sede
      );

    if (
      !clave ||
      marcasUnicas.has(clave)
    ) {
      return;
    }

    marcasUnicas.add(clave);

    agregarSede(sede);

    marcasNuevas.push({
      ...reg,
      sede
    });
  };


  // =====================================================
  // HELPER: FORMATO ANTIGUO detalle[]
  // =====================================================

  const agregarLegacy = (
    reg,
    sedeFallback = null
  ) => {
    if (!reg?.fechaHora) {
      return;
    }

    if (
      dayMX(reg.fechaHora) !== fechaStr
    ) {
      return;
    }

    const sede =
      reg.sede ??
      sedeFallback ??
      null;

    const tipo =
      normalizarTexto(
        reg.tipo
      );

    agregarSede(sede);

    const registro = {
      ...reg,
      sede
    };


    /*
     * Entradas del formato viejo
     */
    if (
      tipo === 'entrada' ||
      tipo === 'asistencia' ||
      tipo === 'entrada manual'
    ) {
      entradasLegacy.push(
        registro
      );

      totalRegistros++;
    }


    /*
     * Salidas del formato viejo
     */
    if (
      tipo.startsWith('salida')
    ) {
      salidasLegacy.push(
        registro
      );

      totalRegistros++;
    }
  };


  // =====================================================
  // RECORRER TODOS LOS DOCUMENTOS
  // =====================================================

  for (
    const asistencia
    of asistencias || []
  ) {
    const sedeDoc =
      asistencia.sede ??
      null;

    agregarSede(
      sedeDoc
    );


    // ===================================================
    // FORMATO NUEVO PRINCIPAL
    //
    // registros[]
    // ===================================================

    if (
      Array.isArray(
        asistencia.registros
      ) &&
      asistencia.registros.length > 0
    ) {
      const registrosDia =
        asistencia.registros.filter(
          (r) =>
            dayMX(r.fechaHora) === fechaStr
        );

      if (
        registrosDia.length > 0
      ) {
        usoFormatoNuevo =
          true;

        totalRegistros +=
          registrosDia.length;

        for (
          const registro
          of registrosDia
        ) {
          agregarMarcaNueva(
            registro,
            sedeDoc
          );
        }

        /*
         * IMPORTANTE:
         *
         * Si registros[] ya contiene
         * las marcas del documento,
         *
         * NO volvemos a utilizar
         * primerRegistro / ultimoRegistro.
         *
         * Así evitamos duplicados.
         */
        continue;
      }
    }


    // ===================================================
    // FORMATO NUEVO RESUMIDO
    //
    // primerRegistro
    // ultimoRegistro
    // totalRegistros
    // ===================================================

    if (
      asistencia.fecha === fechaStr &&
      asistencia.primerRegistro?.fechaHora
    ) {
      usoFormatoNuevo =
        true;

      const cantidadDocumento =
        Math.max(
          Number(
            asistencia.totalRegistros ||
            1
          ),
          1
        );

      totalRegistros +=
        cantidadDocumento;


      // Primera marca del documento
      agregarMarcaNueva(
        asistencia.primerRegistro,
        sedeDoc
      );


      /*
       * Si este documento tiene
       * más de una marca,
       * agregamos también la última.
       */
      if (
        cantidadDocumento > 1 &&
        asistencia.ultimoRegistro?.fechaHora
      ) {
        agregarMarcaNueva(
          asistencia.ultimoRegistro,
          sedeDoc
        );
      }

      continue;
    }


    // ===================================================
    // FORMATO ANTIGUO
    //
    // detalle[]
    // ===================================================

    if (
      Array.isArray(
        asistencia.detalle
      ) &&
      asistencia.detalle.length > 0
    ) {
      for (
        const detalle
        of asistencia.detalle
      ) {
        agregarLegacy(
          detalle,
          sedeDoc
        );
      }
    }
  }


  // =====================================================
  // CONSTRUIR RESULTADO
  // =====================================================

  let entradaReg = null;
  let salidaReg = null;


  // =====================================================
  // FORMATO NUEVO
  //
  // PRIMERA MARCA GLOBAL = ENTRADA
  // ÚLTIMA MARCA GLOBAL  = SALIDA
  // =====================================================

  if (usoFormatoNuevo) {
    /*
     * Si por alguna razón existen documentos
     * nuevos y viejos mezclados en el mismo día,
     * incorporamos también los registros viejos.
     */
    const todasLasMarcas = [
      ...marcasNuevas,
      ...entradasLegacy,
      ...salidasLegacy
    ];


    /*
     * Segunda protección contra duplicados
     * al combinar formatos.
     */
    const unicas = [];
    const clavesGlobales =
      new Set();


    for (
      const registro
      of todasLasMarcas
    ) {
      const sede =
        registro.sede ??
        null;

      const clave =
        crearClave(
          registro,
          sede
        );

      if (
        !clave ||
        clavesGlobales.has(clave)
      ) {
        continue;
      }

      clavesGlobales.add(
        clave
      );

      unicas.push(
        registro
      );
    }


    /*
     * Ordenar TODAS las marcas
     * cronológicamente.
     */
    unicas.sort(
      (a, b) => {
        return (
          getMillis(a.fechaHora) -
          getMillis(b.fechaHora)
        );
      }
    );


    /*
     * Si existe al menos una marca:
     *
     * Primera marca global = Entrada.
     */
    if (
      unicas.length >= 1
    ) {
      entradaReg = {
        ...unicas[0],
        tipo: 'Entrada'
      };
    }


    /*
     * Si existen dos o más marcas:
     *
     * Última marca global = Salida.
     */
    if (
      unicas.length >= 2
    ) {
      salidaReg = {
        ...unicas[
          unicas.length - 1
        ],
        tipo: 'Salida'
      };
    }


    /*
     * En caso de duplicados removidos,
     * preferimos como mínimo el número
     * real de marcas únicas.
     */
    totalRegistros =
      Math.max(
        totalRegistros,
        unicas.length
      );
  }


  // =====================================================
  // FORMATO VIEJO
  //
  // CONSERVAR TIPOS ORIGINALES
  // =====================================================

  else {
    entradasLegacy.sort(
      (a, b) => {
        return (
          getMillis(a.fechaHora) -
          getMillis(b.fechaHora)
        );
      }
    );


    salidasLegacy.sort(
      (a, b) => {
        return (
          getMillis(a.fechaHora) -
          getMillis(b.fechaHora)
        );
      }
    );


    /*
     * Primera entrada registrada.
     */
    if (
      entradasLegacy.length > 0
    ) {
      entradaReg =
        entradasLegacy[0];
    }


    /*
     * Última salida registrada.
     */
    if (
      salidasLegacy.length > 0
    ) {
      salidaReg =
        salidasLegacy[
          salidasLegacy.length - 1
        ];
    }
  }


  // =====================================================
  // RESULTADO FINAL
  // =====================================================

  return {
    entradaReg,
    salidaReg,

    entrada:
      entradaReg
        ? timeMX(
            entradaReg.fechaHora
          )
        : '',

    salida:
      salidaReg
        ? timeMX(
            salidaReg.fechaHora
          )
        : '',

    totalRegistros,

    sedesPresentes:
      Array.from(
        sedesDia
      ),

    /*
     * Estos campos permiten saber
     * exactamente dónde inició
     * y dónde terminó la jornada.
     */
    sedeEntrada:
      entradaReg?.sede ??
      null,

    sedeSalida:
      salidaReg?.sede ??
      null
  };
}


/**
 * Interpreta el estado final de un día.
 *
 * Prioridad:
 *
 * 1. Evento del trabajador
 * 2. Asistencia real
 * 3. Evento de sede
 * 4. Descanso por horario
 * 5. Falta
 *
 *
 * REGLAS DE MARCAS:
 *
 * 0 marcas:
 *   Falta
 *
 * 1 marca antes de salida esperada:
 *   - jornada en curso = Pendiente
 *   - jornada terminada = Salida Automática
 *
 * 1 marca después de salida esperada:
 *   Registro incompleto
 *
 * 2 o más marcas:
 *   Primera = Entrada
 *   Última = Salida
 *   Asistencia Completa
 */
function interpretarDia({
  fechaStr,
  sedeDoc,
  marcas,
  eventoTrabajador,
  eventoSede
}) {
  const horario =
    obtenerHorarioLaboral(
      fechaStr,
      sedeDoc
    );

  const entrada =
    marcas?.entrada ||
    '';

  const salida =
    marcas?.salida ||
    '';


  // =====================================================
  // 1. EVENTO INDIVIDUAL DEL TRABAJADOR
  // =====================================================

  if (eventoTrabajador) {
    const tipoEvt =
      normalizarTexto(
        eventoTrabajador.tipo
      );

    if (
      tipoEvt === 'asistencia' &&
      eventoTrabajador.horaEntrada &&
      eventoTrabajador.horaSalida
    ) {
      return {
        estado:
          'Asistencia Manual',

        entrada:
          eventoTrabajador.horaEntrada,

        salida:
          eventoTrabajador.horaSalida,

        horario,

        fuenteEstado:
          'eventoTrabajador'
      };
    }


    return {
      estado:
        eventoTrabajador.tipo,

      entrada:
        '',

      salida:
        '',

      horario,

      fuenteEstado:
        'eventoTrabajador'
    };
  }


  // =====================================================
  // 2. ASISTENCIA REAL DEL CHECADOR
  // =====================================================

  /*
   * Si existe asistencia real,
   * nunca debe convertirse en descanso.
   */


  // =====================================================
  // CASO A:
  //
  // TIENE ENTRADA Y SALIDA
  // =====================================================

  if (
    marcas?.entradaReg &&
    marcas?.salidaReg
  ) {
    const entradaHora =
      timeMX(
        marcas
          .entradaReg
          .fechaHora
      );

    const salidaHora =
      timeMX(
        marcas
          .salidaReg
          .fechaHora
      );


    /*
     * Protección:
     *
     * Si entrada y salida terminaron
     * exactamente en la misma hora/minuto,
     * no debe considerarse
     * Asistencia Completa.
     */
    if (
      entradaHora === salidaHora
    ) {
      return {
        estado:
          'Salida Automática',

        entrada:
          entradaHora,

        salida:
          '',

        sedeEntrada:
          marcas?.sedeEntrada ??
          marcas?.entradaReg?.sede ??
          null,

        sedeSalida:
          null,

        horario,

        fuenteEstado:
          'asistencia'
      };
    }


    /*
     * Jornada completa.
     */
    return {
      estado:
        'Asistencia Completa',

      entrada,

      salida,

      sedeEntrada:
        marcas?.sedeEntrada ??
        marcas?.entradaReg?.sede ??
        null,

      sedeSalida:
        marcas?.sedeSalida ??
        marcas?.salidaReg?.sede ??
        null,

      horario,

      fuenteEstado:
        'asistencia'
    };
  }


  // =====================================================
  // CASO B:
  //
  // TIENE UNA SOLA MARCA
  // =====================================================

  if (
    marcas?.entradaReg &&
    !marcas?.salidaReg
  ) {
    const horaUnica =
      timeMX(
        marcas
          .entradaReg
          .fechaHora
      );

    const marcaMin =
      toMinutes(
        horaUnica
      );

    const salidaEsperadaMin =
      toMinutes(
        horario
          ?.salidaEsperada
      );


    // ===================================================
    // ÚNICA MARCA DESPUÉS DE LA HORA DE SALIDA
    // ===================================================

    /*
     * Ejemplo:
     *
     * Jornada:
     * 08:00 - 18:00
     *
     * Única marca:
     * 18:46
     *
     * Se interpreta como:
     *
     * olvidó registrar entrada
     * pero sí registró salida.
     */
    if (
      Number(
        marcas?.totalRegistros ||
        0
      ) <= 1 &&

      marcaMin != null &&

      salidaEsperadaMin != null &&

      marcaMin >=
        salidaEsperadaMin
    ) {
      return {
        estado:
          'Registro incompleto',

        entrada:
          '',

        salida:
          horaUnica,

        sedeEntrada:
          null,

        sedeSalida:
          marcas?.sedeEntrada ??
          marcas?.entradaReg?.sede ??
          null,

        horario,

        fuenteEstado:
          'asistencia'
      };
    }


    // ===================================================
    // DETERMINAR SI LA JORNADA SIGUE EN CURSO
    // ===================================================

    const ahoraMX =
      DateTime
        .now()
        .setZone(ZONE);

    const hoyStr =
      ahoraMX.toISODate();

    const ahoraMin =
      (
        ahoraMX.hour * 60
      ) +
      ahoraMX.minute;


    // ===================================================
    // HOY Y TODAVÍA NO TERMINA LA JORNADA
    //
    // = PENDIENTE
    // ===================================================

    if (
      fechaStr === hoyStr &&
      (
        salidaEsperadaMin == null ||
        ahoraMin <
          salidaEsperadaMin
      )
    ) {
      return {
        estado:
          'Pendiente',

        entrada:
          horaUnica,

        salida:
          '',

        sedeEntrada:
          marcas?.sedeEntrada ??
          marcas?.entradaReg?.sede ??
          null,

        sedeSalida:
          null,

        horario,

        fuenteEstado:
          'asistencia'
      };
    }


    // ===================================================
    // DÍA TERMINADO Y NUNCA HUBO SEGUNDA MARCA
    //
    // = SALIDA AUTOMÁTICA
    // ===================================================

    return {
      estado:
        'Salida Automática',

      entrada:
        horaUnica,

      salida:
        '',

      sedeEntrada:
        marcas?.sedeEntrada ??
        marcas?.entradaReg?.sede ??
        null,

      sedeSalida:
        null,

      horario,

      fuenteEstado:
        'asistencia'
    };
  }


  // =====================================================
  // CASO C:
  //
  // TIENE SALIDA PERO NO ENTRADA
  //
  // Principalmente para información
  // histórica del formato detalle[].
  // =====================================================

  if (
    !marcas?.entradaReg &&
    marcas?.salidaReg
  ) {
    return {
      estado:
        'Registro incompleto',

      entrada:
        '',

      salida,

      sedeEntrada:
        null,

      sedeSalida:
        marcas?.sedeSalida ??
        marcas?.salidaReg?.sede ??
        null,

      horario,

      fuenteEstado:
        'asistencia'
    };
  }


  // =====================================================
  // 3. EVENTO DE SEDE
  // =====================================================

  if (eventoSede) {
    const tipoEvt =
      normalizarTexto(
        eventoSede.tipo
      );


    if (
      tipoEvt ===
        'media jornada' &&

      eventoSede.horaInicio &&

      eventoSede.horaFin
    ) {
      return {
        estado:
          'Media Jornada',

        entrada:
          eventoSede.horaInicio,

        salida:
          eventoSede.horaFin,

        horario,

        fuenteEstado:
          'eventoSede'
      };
    }


    return {
      estado:
        eventoSede.tipo,

      entrada:
        '',

      salida:
        '',

      horario,

      fuenteEstado:
        'eventoSede'
    };
  }


  // =====================================================
  // 4. DESCANSO POR HORARIO
  // =====================================================

  if (!horario.esLaboral) {
    return {
      estado:
        'Descanso',

      entrada:
        '',

      salida:
        '',

      horario,

      fuenteEstado:
        'horario'
    };
  }


  // =====================================================
  // 5. FALTA
  // =====================================================

  return {
    estado:
      'Falta',

    entrada:
      '',

    salida:
      '',

    horario,

    fuenteEstado:
      'falta'
  };
}


/**
 * Exportaciones
 */
module.exports = {
  ZONE,
  tieneZonaHoraria,
  parseDateTimeMX,
  dayMX,
  timeMX,
  toMinutes,
  normalizarTexto,
  esSedeOficina,
  obtenerHorarioLaboral,
  extraerMarcasDelDia,
  interpretarDia
};