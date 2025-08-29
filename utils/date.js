function toDay(dateLike) {
  const d = new Date(dateLike);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function getSundaysInRange(inicio, fin) {
  const start = toDay(inicio);
  const end = toDay(fin);
  const res = [];
  const cur = new Date(start);
  while (cur.getUTCDay() !== 0) cur.setUTCDate(cur.getUTCDate() + 1); // 0 = domingo
  while (cur <= end) {
    res.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 7);
  }
  return res;
}

function groupByYear(dates) {
  return dates.reduce((acc, d) => {
    const y = d.getUTCFullYear();
    (acc[y] ||= []).push(d);
    return acc;
  }, {});
}

module.exports = { toDay, getSundaysInRange, groupByYear };
