// Configuration: persisted to config.json next to the project root.
// The Anthropic API key can come from the ANTHROPIC_API_KEY env var or the settings UI.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// LOL_COACH_CONFIG lets tests point at a throwaway file instead of the real config.
const CONFIG_PATH = process.env.LOL_COACH_CONFIG || path.join(ROOT, 'config.json');

const DEFAULTS = {
  // Anthropic API key. Empty string means "not set" — the app falls back to
  // built-in, data-driven advice.
  anthropicApiKey: '',
  // Model used for coaching. Opus is the most capable; the settings UI lists
  // cheaper alternatives with cost estimates.
  model: 'claude-opus-4-8',
  // Where League of Legends is installed (used to find the LCU lockfile).
  // Empty string = try common locations + process inspection.
  leaguePath: '',
  // Port for the local web UI.
  port: 3000,
};

let cached = null;

export function getConfig() {
  if (cached) return cached;
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    // No config file yet — that's fine.
  }
  cached = { ...DEFAULTS, ...fileConfig };
  if (!cached.anthropicApiKey && process.env.ANTHROPIC_API_KEY) {
    cached.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  }
  return cached;
}

export function updateConfig(patch) {
  const next = { ...getConfig(), ...patch };
  cached = next;
  // Never write the env-provided key to disk unless the user typed one in.
  const toPersist = { ...next };
  if (!patch.anthropicApiKey && process.env.ANTHROPIC_API_KEY === next.anthropicApiKey) {
    toPersist.anthropicApiKey = '';
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(toPersist, null, 2));
  return next;
}

export const projectRoot = ROOT;

// Everything the app writes lives under this directory: the Data Dragon cache
// and the permanent match archive. LOL_COACH_DATA_DIR lets tests point at a
// throwaway location — the archive holds matches that exist nowhere else, so a
// test suite must never be able to reach the real one.
export const dataRoot = process.env.LOL_COACH_DATA_DIR || path.join(ROOT, 'data');
