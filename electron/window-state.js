// Remembers the window's size and position across launches. Stored in
// userData (even in dev) because this is shell chrome, not app data — it does
// not belong in the LOL_COACH_DATA_DIR archive tree.
import { app, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const statePath = () => path.join(app.getPath('userData'), 'window-state.json');

export function loadWindowState(defaults) {
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch {
    // Missing or corrupt — defaults.
  }
  if (!saved || !Number.isFinite(saved.width) || !Number.isFinite(saved.height)) {
    return { bounds: defaults, maximized: false };
  }
  // A remembered position on a monitor that is no longer plugged in would put
  // the window off-screen; require some overlap with a current display.
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return (
      saved.x < a.x + a.width - 40 &&
      saved.x + saved.width > a.x + 40 &&
      saved.y < a.y + a.height - 40 &&
      saved.y >= a.y - 20
    );
  });
  if (!visible) return { bounds: { width: saved.width, height: saved.height }, maximized: Boolean(saved.maximized) };
  return {
    bounds: { x: saved.x, y: saved.y, width: saved.width, height: saved.height },
    maximized: Boolean(saved.maximized),
  };
}

export function trackWindowState(win) {
  let timer = null;
  const save = () => {
    try {
      // Normal (unmaximized) bounds are what should be restored after a
      // maximize round-trip, so always record those.
      const state = { ...win.getNormalBounds(), maximized: win.isMaximized() };
      fs.mkdirSync(path.dirname(statePath()), { recursive: true });
      fs.writeFileSync(statePath(), JSON.stringify(state));
    } catch {
      // Losing window geometry is never worth an error.
    }
  };
  const debounced = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  win.on('move', debounced);
  win.on('resize', debounced);
  win.on('close', () => {
    clearTimeout(timer);
    save();
  });
}
