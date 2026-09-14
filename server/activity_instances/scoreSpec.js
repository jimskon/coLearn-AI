// Parse score specs without loading the activity controller (and its AI
// dependencies). Keeping this pure makes markup validation safe to run in
// offline test processes.
function parseScoreSpec(specRaw) {
  const spec = String(specRaw || '').trim();
  const out = {};

  // style A: "code=4,output=2,response=4"
  if (spec.includes('=')) {
    for (const part of spec.split(/[;,]/)) {
      const [keyRaw, valueRaw] = part.split('=');
      if (!keyRaw || !valueRaw) continue;
      const key = keyRaw.trim().toLowerCase();
      const value = Number(String(valueRaw).trim());
      if (!Number.isFinite(value)) continue;

      if (key === 'code' || key === 'codes') out.code = value;
      else if (key === 'output' || key === 'run') out.output = value;
      else if (key === 'response') out.response = value;
    }
    return out;
  }

  // style B: "10,code" (or "6,response")
  const parts = spec.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const points = Number(parts[0]);
    const bucket = parts[1].toLowerCase();
    if (Number.isFinite(points)) {
      if (bucket === 'code') out.code = points;
      else if (bucket === 'output' || bucket === 'run') out.output = points;
      else if (bucket === 'response') out.response = points;
    }
  }

  return out;
}

module.exports = { parseScoreSpec };
