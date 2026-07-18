// Compares an Index Row against per-role targets so a number becomes a
// judgement. A raw "6.7 CS/min" means nothing to someone still learning; "6.7,
// target 7.5" is something they can act on.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TABLE = JSON.parse(fs.readFileSync(path.join(HERE, 'benchmarks.json'), 'utf8'));

// Every benchmarked stat here is "higher is better". If a lower-is-better stat
// is ever added (deaths, say), direction needs to invert for it.
const STATS = ['csPerMin', 'visionScore', 'killParticipation'];

export function benchmarkFor(role) {
  return TABLE.roles[role] || null;
}

// Which farm counts toward this role's CS rate: 'lane', 'camps+lane', or 'none'.
// Used by normalize-shared to scope csPerMin — see ADR-0004.
export function csFormulaFor(role) {
  return TABLE.roles[role]?.csFormula ?? null;
}

// Returns { stat: { value, benchmark, direction } } for the stats that are
// meaningful for this row's role. A null benchmark (Support CS) or a null value
// means the stat is omitted entirely — the UI hides it rather than rendering a
// comparison against nothing.
export function compareToBenchmark(row) {
  const bm = benchmarkFor(row?.role);
  if (!bm) return {};
  const out = {};
  for (const stat of STATS) {
    const target = bm[stat];
    const value = row?.[stat];
    if (target === null || target === undefined) continue;
    if (value === null || value === undefined) continue;
    out[stat] = {
      value,
      benchmark: target,
      direction: value >= target ? 'above' : 'below',
    };
  }
  return out;
}
