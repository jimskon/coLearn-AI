// client/src/utils/time.js
// Convert UTC ISO string -> "YYYY-MM-DDTHH:MM" in local time
export function utcToLocalInputValue(utcString) {
  if (!utcString) return '';

  const d = new Date(utcString); // interpreted as UTC, but getters are local
  const pad = (n) => String(n).padStart(2, '0');

  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1); // 0-based
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());

  return `${year}-${month}-${day}T${hours}:${mins}`;
}

// UTC ISO string -> human-readable local string
export function formatLocalDateTime(utcString) {
  if (!utcString) return '';
  const d = new Date(utcString);
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

// Normalizes MySQL DATETIME to a JS-friendly local datetime
export function normalizeDbDatetime(value) {
  if (!value) return '';

  // MySQL DATETIME → treat as LOCAL time (NOT UTC)
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return value.replace(' ', 'T');  // NO 'Z'
  }

  return value;
}


// Input can be:
//  - "2025-12-04 02:59:00"        (MySQL DATETIME stored as UTC)
//  - "2025-12-04T02:59:00"        (no zone; treat as UTC)
//  - "2025-12-04T02:59:00.000Z"   (ISO UTC)
//  - Date object
// Output: "YYYY-MM-DD h:mmAM" in *browser local time*
export function formatUtcToLocal(value) {
  if (!value) return '';

  const pad2 = (n) => String(n).padStart(2, '0');

  const fmt = (d) => {
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());

    let h = d.getHours();
    const min = pad2(d.getMinutes());
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;

    return `${y}-${m}-${day} ${h}:${min}${ampm}`;
  };

  // Date object?
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : fmt(value);
  }

  const s = String(value).trim();

  // MySQL DATETIME "YYYY-MM-DD HH:MM:SS" -> treat as UTC
  let m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = Number(m[6] ?? 0);

    const d = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    return Number.isNaN(d.getTime()) ? '' : fmt(d);
  }

  // ISO (with Z / offset / milliseconds) -> Date parses it correctly as UTC
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : fmt(d);
}


// Input:  "2025-12-04 02:59:00" or "2025-12-04T02:59:00"
// Output: Date object (local representation, but constructed from UTC fields)
// Convert MySQL DATETIME (UTC) or ISO to a Date object (UTC)
export function parseUtcDbDatetime(value) {
  if (!value) return null;

  // MySQL DATETIME: "YYYY-MM-DD HH:MM:SS" -> treat as UTC
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    const iso = value.replace(' ', 'T') + 'Z'; // mark as UTC
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Already ISO or something Date can parse
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
