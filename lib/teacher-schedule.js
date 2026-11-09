// ─────────────────────────────────────────────────────────────────────────────
// Scheduling prof — math dates / fuseaux horaires PURE (aucune dépendance DB).
// Extrait de routes/mobile.js. Les heures de dispo du prof (hour 0..23 / weekday /
// date) sont LOCALES AU PROF ; on les convertit en instant UTC exact (gère l'heure
// d'été via Intl), l'élève les ré-affiche ensuite dans son propre fuseau.
// ─────────────────────────────────────────────────────────────────────────────

const SLOT_MIN = 60;             // durée d'un créneau (1h)
const BOOKING_HORIZON_DAYS = 28; // fenêtre de réservation glissante

// Valide un identifiant de fuseau IANA (sinon null → fallback 'UTC' côté appelant).
function validTz(v) { try { new Intl.DateTimeFormat('en-US', { timeZone: v }); return v; } catch { return null; } }

const pad2 = (n) => String(n).padStart(2, '0');

// Décalage (ms) tel que : heure_murale_du_fuseau = instant_utc + offset.
function tzOffsetMs(utcDate, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = {}; for (const part of dtf.formatToParts(utcDate)) p[part.type] = part.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour === 24 ? 0 : +p.hour, +p.minute, +p.second);
  return asUTC - utcDate.getTime();
}

// Instant UTC pour une heure MURALE (y, m0, d, hour) dans `tz` (gère l'heure d'été).
function wallToUtc(y, m0, d, hour, tz) {
  const guess = Date.UTC(y, m0, d, hour, 0, 0);
  const off1 = tzOffsetMs(new Date(guess), tz);
  const off2 = tzOffsetMs(new Date(guess - off1), tz); // raffine (bord DST)
  return new Date(guess - off2);
}

// Décompose un instant UTC en heure murale du fuseau : { weekday(Mon0), hour, y,m,d }.
const WD_MON0 = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
function utcToWall(utcDate, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' });
  const p = {}; for (const part of dtf.formatToParts(utcDate)) p[part.type] = part.value;
  return { weekday: WD_MON0[p.weekday], hour: +p.hour === 24 ? 0 : +p.hour, year: +p.year, month: +p.month, day: +p.day };
}

// Dérive les créneaux RÉSERVABLES (instants UTC) à partir de la semaine type + des
// overrides par date du prof, dans SON fuseau. `bookedSet` = Set d'ISO déjà réservés.
function deriveTeacherSlots({ tz, blocks, dateMap, bookedSet, horizonDays }) {
  const byWd = new Map(); // weekday -> Set(hours)
  (blocks || []).forEach((b) => { if (!byWd.has(b.weekday)) byWd.set(b.weekday, new Set()); byWd.get(b.weekday).add(b.hour); });
  const out = [];
  const now = Date.now();
  const today = utcToWall(new Date(), tz); // date locale du prof « aujourd'hui »
  for (let i = 0; i <= horizonDays; i++) {
    // Arithmétique de calendrier sur la date locale du prof (via UTC pour getUTCDay).
    const base = new Date(Date.UTC(today.year, today.month - 1, today.day));
    base.setUTCDate(base.getUTCDate() + i);
    const y = base.getUTCFullYear(), m0 = base.getUTCMonth(), d = base.getUTCDate();
    const dayKey = `${y}-${pad2(m0 + 1)}-${pad2(d)}`;
    const wd = (base.getUTCDay() + 6) % 7;
    const override = dateMap.get(dayKey);               // override ponctuel (remplace le récurrent)
    const hours = override ? [...override] : [...(byWd.get(wd) || [])];
    for (const hour of hours) {
      const startUtc = wallToUtc(y, m0, d, hour, tz);
      if (startUtc.getTime() <= now) continue;
      const iso = startUtc.toISOString();
      if (bookedSet && bookedSet.has(iso)) continue;
      out.push({ starts_at: iso, ends_at: new Date(startUtc.getTime() + SLOT_MIN * 60000).toISOString() });
    }
  }
  out.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  return out;
}

module.exports = {
  SLOT_MIN, BOOKING_HORIZON_DAYS,
  validTz, pad2, tzOffsetMs, wallToUtc, utcToWall, deriveTeacherSlots,
};
