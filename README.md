# Galaxy Swarm

Galaxy Swarm is a self-contained desktop web arcade shooter. It uses native ES modules, HTML5 Canvas, the Web Audio API, and Node's built-in test runner, so it can be run without installing third-party packages.

## Run

```text
node scripts/server.mjs
```

Then open `http://localhost:4173` in a desktop browser. The server serves the repository root and has no external network dependency.

Run the deterministic gameplay tests with:

```text
node --test
```

## Controls

- `ArrowLeft` / `A`: move left
- `ArrowRight` / `D`: move right
- `Space` / `Z`: fire, or confirm a menu option
- `P` / `Escape`: pause
- `ArrowUp` / `ArrowDown`: menu navigation
- `ArrowLeft` / `ArrowRight`: change a setting while the settings panel is open
- `Enter`: confirm

## Decisions recorded for the acceptance build

- T-001: native JavaScript ES2022 modules + HTML5 Canvas; Node built-in tests; Chromium, Firefox, and Safari desktop are the supported browser families. A dependency-free build is used so the same source runs from a clean checkout.
- T-002: the checked-in generated RGBA sprite sheets in `public/assets/sprites/` are used for player/enemy presentation, with original vector geometry as a resilient fallback and Web Audio oscillator tones for sound. No original Galaga assets, logos, characters, or sounds are included.
- OI-001: the combo multiplier applies to enemy and boss-kernel defeat points only. Wave-clear and bonus-wave awards remain fixed, as specified by the task document's T-025 wording.
- OI-002: bonus wave is enabled and starts after wave 5, with a 30-second limit.
- OI-003: acceptance baseline is Chromium 120+ on Windows 10/11 at 960x540 and 640x360; Firefox 120+ and Safari 17+ are supported smoke-test targets.
- OI-004: settings are available from the pause menu and are persisted with the high score.
- OI-005: the post-boss state is `LOOP_COMPLETE`; `Enter` starts a new game and `Escape` returns to the title screen.

## Project map

- `public/index.html`: canvas shell and accessible status surface
- `src/main.js`: browser input, rendering, responsive layout, audio, and storage wiring
- `src/game/engine.js`: deterministic game state, rules, collisions, scoring, and lifecycle
- `src/game/pool.js`: reusable projectile/particle pools
- `src/data/waves.js`: external wave configuration
- `tests/`: acceptance-oriented deterministic tests

Use `?debug=1` to show hitboxes and runtime counters. The page exposes `window.__GALAXY_SWARM__` for manual inspection and smoke testing.
