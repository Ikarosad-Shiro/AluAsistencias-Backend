// utils/date.js
// Helpers de fecha “a prueba de TZ” para días de calendario.
// Estrategia: normalizamos SIEMPRE al MEDIODÍA UTC (12:00Z) para evitar
// que el día “retroceda/avance” cuando se convierte en distintas zonas horarias.

const NOON_UTC_HOUR = 12;
const YMD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isYmdString(v) {
  return typeof v === 'string' && YMD_REGEX.test(v);
}

// 'YYYY-MM-DD' -> Date en 12:00:00.000Z
function ymdToNoonUTC(ymd) {
  if (!isYmdString(ymd)) throw new Error(`ymdToNoonUTC: formato inválido "${ymd}"`);
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, NOON_UTC_HOUR, 0, 0, 0));
}

// Cualquier cosa parseable -> mismo día a las 12:00:00.000Z
function normalizeToNoonUTC(dateLike) {
  if (dateLike == null) throw new Error('normalizeToNoonUTC: dateLike requerido');

  if (isYmdString(dateLike)) {
    return ymdToNoonUTC(dateLike);
  }

  const d = new Date(dateLike);
  if (isNaN(d.getTime())) {
    throw new Error(`normalizeToNoonUTC: valor de fecha inválido "${dateLike}"`);
  }

  // Tomamos el día en UTC del valor y lo fijamos a 12:00Z
  return new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    NOON_UTC_HOUR, 0, 0, 0
  ));
}

// API pública esperada en tu código:

// toDay: normaliza un dateLike al "día" estable (12:00Z)
function toDay(dateLike) {
  return normalizeToNoonUTC(dateLike);
}

// Devuelve todos los domingos entre inicio y fin (inclusive), normalizados a 12:00Z
function getSundaysInRange(inicio, fin) {
  const start = normalizeToNoonUTC(inicio);
  const end   = normalizeToNoonUTC(fin);
  if (start > end) return [];

  const res = [];
  const cur = new Date(start.getTime());

  // Mover al primer domingo (0 = domingo en getUTCDay)
  const delta = (7 - cur.getUTCDay()) % 7; // 0..6 (si ya es domingo, delta=0)
  cur.setUTCDate(cur.getUTCDate() + delta);

  while (cur <= end) {
    res.push(new Date(cur.getTime())); // push copia
    cur.setUTCDate(cur.getUTCDate() + 7);
  }
  return res;
}

// Agrupa por año (UTC) devolviendo copias seguras
function groupByYear(dates) {
  return (dates || []).reduce((acc, d) => {
    const dt = normalizeToNoonUTC(d);
    const y = dt.getUTCFullYear();
    (acc[y] ||= []).push(new Date(dt.getTime()));
    return acc;
  }, {});
}

// Extra útiles:

// Date/ISO/YMD -> 'YYYY-MM-DD' estable
function toYmd(dateLike) {
  const dt = normalizeToNoonUTC(dateLike);
  return dt.toISOString().slice(0, 10);
}

module.exports = {
  // originales
  toDay,
  getSundaysInRange,
  groupByYear,
  // extra
  toYmd,
  ymdToNoonUTC,
  normalizeToNoonUTC,
  isYmdString
};
