// backend/scripts/migrar-trabajadores-v2.js
require('dotenv').config();
const mongoose = require('mongoose');

// 🔌 Modelos
const Trabajador = require('../models/Trabajador');
const Sede = require('../models/Sede');

// ⚙️ Opcional: --dry para simulación (no guarda cambios)
const DRY_RUN = process.argv.includes('--dry');

(async () => {
  try {
    if (!process.env.MONGO_URI) {
      console.error('❌ Falta MONGO_URI en .env');
      process.exit(1);
    }
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`🔗 Conectado a MongoDB (${DRY_RUN ? 'DRY RUN' : 'LIVE'})`);

    const toDate = (v) => {
      if (!v) return null;
      try {
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
      } catch { return null; }
    };

    const toNumber = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const sedeName = async (idNum) => {
      if (idNum == null) return '';
      const s = await Sede.findOne({ id: idNum }).lean();
      return s?.nombre || '';
    };

    const all = await Trabajador.find();
    console.log(`👷 Trabajadores encontrados: ${all.length}`);

    let updated = 0;

    for (const t of all) {
      let changed = false;

      // =========================
      // 1) Normalizar historialSedes (tipos)
      // =========================
      if (Array.isArray(t.historialSedes)) {
        let modHist = false;
        t.historialSedes = t.historialSedes.map((h) => {
          const origId = h.idSede;
          const idNum = toNumber(h.idSede);
          const fi = toDate(h.fechaInicio);
          const ff = toDate(h.fechaFin);
          if (idNum !== origId || fi !== h.fechaInicio || ff !== h.fechaFin) modHist = true;
          return {
            idSede: idNum,
            nombre: h.nombre || '',
            fechaInicio: fi,
            fechaFin: ff || null
          };
        });
        if (modHist) changed = true;
      } else {
        t.historialSedes = [];
      }

      // =========================
      // 2) Resolver principal según estado
      // =========================
      const estado = t.estado || 'activo';
      let principal = toNumber(t.sedePrincipal ?? t.sede);

      // Si ACTIVO y no hay principal, intentar derivarlo del historial
      if (estado === 'activo' && (principal == null)) {
        // Preferimos un historial abierto
        const abiertos = t.historialSedes.filter(h => h && h.fechaFin == null && h.idSede != null);
        if (abiertos.length > 0) {
          // si hay más de uno, elegir el último por fechaInicio
          abiertos.sort((a, b) => (toDate(a.fechaInicio) - toDate(b.fechaInicio)));
          principal = abiertos[abiertos.length - 1].idSede;
        } else if (t.historialSedes.length > 0) {
          // si no hay abierto, tomar el más reciente por fechaInicio
          const hCopy = [...t.historialSedes].filter(h => h.idSede != null);
          hCopy.sort((a, b) => (toDate(a.fechaInicio) - toDate(b.fechaInicio)));
          principal = hCopy[hCopy.length - 1]?.idSede ?? null;
        }
      }

      // Si INACTIVO, principal debe quedar null
      if (estado === 'inactivo') {
        if (t.sede !== null || t.sedePrincipal !== null) changed = true;
        t.sede = null;
        t.sedePrincipal = null;
      } else {
        // ACTIVO → espejo principal a sede + sedePrincipal
        if (principal != null) {
          if (t.sede !== principal || t.sedePrincipal !== principal) changed = true;
          t.sede = principal;
          t.sedePrincipal = principal;
        }
      }

      // =========================
      // 3) sedesForaneas (normalizar y deduplicar, sin límite)
      // =========================
      const foras = Array.isArray(t.sedesForaneas) ? t.sedesForaneas.map(toNumber).filter(x => x != null) : [];
      const uniqForas = [...new Set(foras)].filter(x => x !== (t.sedePrincipal ?? t.sede));
      if (JSON.stringify(uniqForas) !== JSON.stringify(foras)) {
        t.sedesForaneas = uniqForas;
        changed = true;
      }

      // =========================
      // 4) Historial coherente con estado
      // =========================
      if (estado === 'activo') {
        if (t.sedePrincipal != null) {
          const principalNow = t.sedePrincipal;

          // Cerrar historiales abiertos que no sean del principal
          let cerrados = 0;
          t.historialSedes = t.historialSedes.map(h => {
            if (h.fechaFin == null && h.idSede !== principalNow) {
              h.fechaFin = toDate(t.updatedAt) || new Date();
              cerrados++;
              changed = true;
            }
            return h;
          });

          // ¿Existe abiertos del principal?
          const abiertosPrincipal = t.historialSedes.filter(h => h.idSede === principalNow && h.fechaFin == null);

          if (abiertosPrincipal.length === 0) {
            // Abrir uno nuevo para principal
            const nombre = await sedeName(principalNow);
            t.historialSedes.push({
              idSede: principalNow,
              nombre,
              fechaInicio: toDate(t.updatedAt) || toDate(t.createdAt) || new Date(),
              fechaFin: null
            });
            changed = true;
          } else if (abiertosPrincipal.length > 1) {
            // Dejar solo el más reciente abierto
            abiertosPrincipal.sort((a, b) => (toDate(a.fechaInicio) - toDate(b.fechaInicio)));
            const keep = abiertosPrincipal[abiertosPrincipal.length - 1];
            for (const h of abiertosPrincipal) {
              if (h !== keep) {
                h.fechaFin = toDate(t.updatedAt) || new Date();
                changed = true;
              }
            }
          }
        }
      } else {
        // INACTIVO → cerrar cualquier historial abierto
        let cerrados = 0;
        t.historialSedes = t.historialSedes.map(h => {
          if (h.fechaFin == null) {
            h.fechaFin = toDate(t.updatedAt) || new Date();
            cerrados++;
            changed = true;
          }
          return h;
        });
      }

      // =========================
      // 5) Si ACTIVO sin historial, abrir uno con sedePrincipal si existe
      // =========================
      if (estado === 'activo' && t.historialSedes.length === 0 && t.sedePrincipal != null) {
        const nombre = await sedeName(t.sedePrincipal);
        t.historialSedes.push({
          idSede: t.sedePrincipal,
          nombre,
          fechaInicio: toDate(t.createdAt) || new Date(),
          fechaFin: null
        });
        changed = true;
      }

      // =========================
      // 6) Guardar si hubo cambios
      // =========================
      if (changed) {
        updated++;
        if (!DRY_RUN) {
          await t.save();
        }
        console.log(`✅ ${t.nombre} (${t._id}) actualizado`);
      } else {
        console.log(`↔️  ${t.nombre} (${t._id}) sin cambios`);
      }
    }

    console.log(`\n🎉 Migración terminada. Modificados: ${updated}/${all.length} ${DRY_RUN ? '(DRY RUN)' : ''}`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (e) {
    console.error('❌ Error en migración:', e);
    process.exit(1);
  }
})();
