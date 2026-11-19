// Génération d'un flux iCalendar (RFC 5545) pour les cours Jiayou.
// Sens unique : on publie les créneaux réservés d'un utilisateur dans un .ics
// auquel Google / Apple / Outlook peuvent s'abonner (auto-refresh côté provider).

// Échappe un texte pour une valeur de propriété ICS (RFC 5545 §3.3.11).
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Pliage des lignes > 75 octets (RFC 5545 §3.1) : on coupe et on préfixe d'un
// espace. On compte en octets UTF-8 pour ne jamais couper au milieu d'un char.
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out = [];
  let start = 0;
  let limit = 75; // 1re ligne : 75 ; suivantes : 74 (+ l'espace de continuation)
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Recule pour ne pas scinder un caractère multi-octets UTF-8.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push((start === 0 ? '' : ' ') + bytes.slice(start, end).toString('utf8'));
    start = end;
    limit = 74;
  }
  return out.join('\r\n');
}

// events: [{ uid, start, end, summary, description, location, status, cancelled }]
//   start/end : déjà formatés en UTC compact "YYYYMMDDTHHMMSSZ".
function buildCalendar(events, { name = 'Jiayou', domain = 'jiayou.fr' } = {}) {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Jiayou//Lessons//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`,
    `NAME:${esc(name)}`,
    // Indique au client un rafraîchissement ~toutes les heures (indicatif).
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${esc(ev.uid)}@${domain}`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART:${ev.start}`);
    lines.push(`DTEND:${ev.end}`);
    lines.push(`SUMMARY:${esc(ev.summary)}`);
    if (ev.description) lines.push(`DESCRIPTION:${esc(ev.description)}`);
    if (ev.location) lines.push(`LOCATION:${esc(ev.location)}`);
    lines.push(`STATUS:${ev.cancelled ? 'CANCELLED' : 'CONFIRMED'}`);
    if (ev.cancelled) lines.push('METHOD:CANCEL');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { buildCalendar, esc };
