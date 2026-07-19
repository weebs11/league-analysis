// Pre-generated champion briefings — a checked-in library covering every
// champion, written once at authoring time (see briefings/manifest.json for
// the patch and model that produced it). Serving from here makes the champ
// select briefing instant, free, and independent of any API key.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as ddragon from './ddragon.js';

const BRIEFINGS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'briefings');

let library = null; // Map ddragon id -> briefing
let manifest = null;

function load() {
  if (library) return;
  library = new Map();
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(BRIEFINGS_DIR, 'manifest.json'), 'utf8'));
    for (const file of fs.readdirSync(BRIEFINGS_DIR)) {
      if (!file.endsWith('.json') || file === 'manifest.json') continue;
      try {
        const b = JSON.parse(fs.readFileSync(path.join(BRIEFINGS_DIR, file), 'utf8'));
        if (b?.id) library.set(b.id, b);
      } catch {
        // One corrupt file shouldn't take down the rest of the library.
      }
    }
  } catch {
    // No library shipped — champSelectAdvice returns null and the caller
    // falls back to basic mode.
  }
}

export function getBriefing(champId) {
  load();
  return library.get(champId) || null;
}

export function libraryInfo() {
  load();
  return library.size
    ? { patch: manifest?.patch || null, model: manifest?.model || null, count: library.size }
    : null;
}

// Assembles the champ-select advice shape (same one the AI generator used)
// from the library: the player's champion briefing plus a "what to expect"
// line per known enemy. Returns null when the player's champion has no
// briefing — e.g. a champion released after the library was generated.
export async function champSelectAdvice(champSelect) {
  load();
  const my = champSelect.me?.champion;
  const briefing = my ? library.get(my.id) : null;
  if (!briefing) return null;

  const knownEnemies = [];
  for (const member of champSelect.theirTeam) {
    if (!member.champion) continue;
    const enemy = library.get(member.champion.id);
    if (enemy) {
      knownEnemies.push({ champion: enemy.name, whatToExpect: enemy.whatToExpect });
      continue;
    }
    // Enemy missing from the library — fall back to Riot's own tip.
    try {
      const d = await ddragon.champDetails(member.champion.id);
      if (d) {
        knownEnemies.push({
          champion: d.name,
          whatToExpect: d.enemytips[0] || `${d.title} — ${(d.tags || []).join('/')}`,
        });
      }
    } catch {
      // No data at all for this enemy — skip rather than fail the briefing.
    }
  }

  return {
    basicMode: false,
    briefingPatch: manifest?.patch || null,
    yourChampion: {
      playstyleSummary: briefing.playstyleSummary,
      strengths: briefing.strengths,
      weaknesses: briefing.weaknesses,
      abilities: briefing.abilities,
    },
    earlyGamePlan: briefing.earlyGamePlan,
    knownEnemies,
    quickTips: briefing.quickTips,
    glossary: briefing.glossary,
  };
}
