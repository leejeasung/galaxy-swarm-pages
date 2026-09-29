import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine, GAME_STATES, MemoryStorage, ENEMY_DEFS } from "../src/game/engine.js";
import { WAVE_DATA } from "../src/data/waves.js";

function makeEngine(options = {}) {
  return new GameEngine({ storage: new MemoryStorage(), rng: () => 0.25, ...options });
}

function advance(engine, seconds, input = {}) {
  const steps = Math.ceil(seconds / 0.02);
  for (let index = 0; index < steps; index += 1) engine.update(Math.min(0.02, seconds - index * 0.02), input);
}

function toPlaying(engine) {
  engine.startGame();
  advance(engine, 3.1);
  assert.equal(engine.state, GAME_STATES.PLAYING);
}

test("title -> ready -> playing creates a clean three-life session", () => {
  const engine = makeEngine();
  assert.equal(engine.state, GAME_STATES.TITLE);
  engine.startGame();
  assert.equal(engine.state, GAME_STATES.READY);
  assert.equal(engine.lives, 3);
  assert.equal(engine.wave, 1);
  advance(engine, 3.1);
  assert.equal(engine.state, GAME_STATES.PLAYING);
  assert.equal(engine.remainingEnemyCount, WAVE_DATA[0].composition.length);
});

test("movement uses delta time and remains inside the playable rectangle", () => {
  const engine = makeEngine();
  toPlaying(engine);
  advance(engine, 5, { left: true });
  assert.equal(engine.player.x, engine.player.width / 2);
  advance(engine, 5, { right: true });
  assert.equal(engine.player.x, engine.config.width - engine.player.width / 2);
});

test("fire interval and maximum active player bullets cannot be bypassed", () => {
  const engine = makeEngine();
  toPlaying(engine);
  const fireTimes = [];
  engine.onEvent = (event) => {
    if (event.type === "playerFire") fireTimes.push(engine.stateTime);
  };
  for (let index = 0; index < 40; index += 1) {
    engine.update(0.01, { fire: true });
    assert.ok(engine.playerBullets.length <= 3);
  }
  assert.ok(fireTimes.length >= 2);
  for (let index = 1; index < fireTimes.length; index += 1) assert.ok(fireTimes[index] - fireTimes[index - 1] >= 0.219);
});

test("enemy definitions retain the four required roles and scores", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(ENEMY_DEFS).map(([key, value]) => [key, [value.hp, value.score]])),
    { swarm: [1, 50], diver: [1, 100], guardian: [2, 200], commander: [3, 500] }
  );
});

test("damage is single-use, guarded by hp, and awards combo-scaled integer score", () => {
  const engine = makeEngine();
  toPlaying(engine);
  const enemy = engine.enemies.find((candidate) => candidate.type === "swarm");
  assert.equal(engine.damageEnemy(enemy), true);
  assert.equal(enemy.alive, false);
  assert.equal(engine.score, 50);
  assert.equal(engine.damageEnemy(enemy), false);
  assert.equal(engine.score, 50);
  const second = engine.enemies.find((candidate) => candidate.alive);
  engine.killEnemy(second);
  assert.equal(engine.combo, 2);
  assert.equal(engine.score % 1, 0);
});

test("player hit consumes exactly one life and invincibility blocks repeated hits", () => {
  const engine = makeEngine();
  toPlaying(engine);
  assert.equal(engine.handlePlayerHit({ source: "test" }), true);
  assert.equal(engine.lives, 2);
  assert.equal(engine.state, GAME_STATES.RESPAWNING);
  assert.equal(engine.handlePlayerHit({ source: "test-repeat" }), false);
  assert.equal(engine.lives, 2);
  advance(engine, 2.1);
  assert.equal(engine.player.invincible, 0);
  assert.equal(engine.state, GAME_STATES.PLAYING);
});

test("game over stops simulation and restart removes all prior session objects", () => {
  const engine = makeEngine();
  toPlaying(engine);
  engine.handlePlayerHit();
  advance(engine, 2.1);
  engine.handlePlayerHit();
  advance(engine, 2.1);
  engine.handlePlayerHit();
  assert.equal(engine.state, GAME_STATES.GAME_OVER);
  assert.equal(engine.lives, 0);
  engine.startGame();
  assert.equal(engine.state, GAME_STATES.READY);
  assert.equal(engine.score, 0);
  assert.equal(engine.combo, 0);
  assert.equal(engine.lives, 3);
  assert.equal(engine.playerBullets.length, 0);
  assert.equal(engine.enemyBullets.length, 0);
});

test("pause freezes positions, timers, projectiles, and attack scheduling", () => {
  const engine = makeEngine();
  toPlaying(engine);
  engine.update(0.05, { fire: true });
  const before = engine.getSnapshot();
  const stateTime = engine.stateTime;
  engine.togglePause();
  engine.update(2, { left: true, fire: true });
  const after = engine.getSnapshot();
  assert.equal(engine.state, GAME_STATES.PAUSED);
  assert.deepEqual(after.player, before.player);
  assert.equal(after.playerBullets, before.playerBullets);
  assert.equal(engine.stateTime, stateTime);
  engine.togglePause();
  assert.equal(engine.state, GAME_STATES.PLAYING);
});

test("capture and rescue preserves the captured ship and activates dual fire", () => {
  const engine = makeEngine();
  engine.startWave(7);
  advance(engine, 3.1);
  const commander = engine.enemies.find((enemy) => enemy.type === "commander");
  assert.ok(commander);
  assert.equal(engine.capturePlayer(commander), true);
  assert.ok(engine.capturedShip);
  assert.equal(engine.lives, 3);
  assert.equal(engine.killEnemy(commander), true);
  assert.equal(engine.capturedShip, null);
  assert.equal(engine.player.dual, true);
});

test("bonus wave is active after wave five and ends once with fixed bonus scoring", () => {
  const engine = makeEngine();
  engine.startWave(5);
  advance(engine, 3.1);
  for (const enemy of [...engine.enemies]) engine.killEnemy(enemy);
  advance(engine, 2.1);
  assert.equal(engine.bonus?.active, true);
  assert.equal(engine.state, GAME_STATES.READY);
  advance(engine, 3.1);
  for (const enemy of [...engine.enemies]) engine.killEnemy(enemy);
  assert.equal(engine.bonus.kills, 18);
  advance(engine, 0.02);
  assert.equal(engine.state, GAME_STATES.WAVE_CLEAR);
  const scoreAfterClear = engine.score;
  engine.completeBonus("duplicate-call");
  assert.equal(engine.score, scoreAfterClear);
});

test("boss has 40 hp, exposes phases in order, and resolves only once", () => {
  const engine = makeEngine();
  engine.startWave(10);
  advance(engine, 3.1);
  assert.equal(engine.boss.hp, 40);
  engine.boss.hp = 20;
  engine.update(0.02);
  assert.equal(engine.boss.bossPhase, 2);
  engine.boss.hp = 10;
  engine.update(0.02);
  assert.equal(engine.boss.bossPhase, 3);
  engine.boss.hp = 1;
  engine.damageEnemy(engine.boss, 1);
  assert.equal(engine.state, GAME_STATES.LOOP_COMPLETE);
  const finalScore = engine.score;
  assert.equal(engine.completeBoss(), false);
  assert.equal(engine.score, finalScore);
});

test("high score, settings, and save failures are non-blocking", () => {
  const storage = new MemoryStorage();
  const engine = new GameEngine({ storage });
  engine.addScore(123);
  assert.equal(engine.highScore, 123);
  const restored = new GameEngine({ storage });
  assert.equal(restored.highScore, 123);
  restored.settingsIndex = 0;
  restored.adjustSetting(-0.2);
  const restoredSettings = new GameEngine({ storage });
  assert.equal(restoredSettings.settings.musicVolume, 0.8);

  const failingStorage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); }
  };
  const safe = new GameEngine({ storage: failingStorage });
  assert.doesNotThrow(() => safe.addScore(999));
  assert.equal(safe.score, 999);
});

test("wave configuration is external, ordered, and carries the required difficulty ramp", () => {
  assert.equal(WAVE_DATA.length, 10);
  assert.deepEqual(WAVE_DATA.map((wave) => wave.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(WAVE_DATA[9].boss, true);
  assert.equal(WAVE_DATA[0].composition.every((type) => type === "swarm"), true);
  assert.ok(WAVE_DATA[5].composition.includes("commander"));
  assert.ok(WAVE_DATA[8].composition.length >= WAVE_DATA[0].composition.length);
});

test("formation warning and attack scheduling never exceed three simultaneous attackers", () => {
  const engine = makeEngine();
  engine.startWave(9);
  advance(engine, 4);
  engine.formation.attackCooldown = 0;
  for (let index = 0; index < 200; index += 1) {
    engine.formation.attackCooldown = 0;
    engine.update(0.02, {});
    assert.ok(engine.activeAttackers.length <= 3);
  }
});

test("removed owners cannot leave active enemy projectiles behind", () => {
  const engine = makeEngine();
  toPlaying(engine);
  const guardian = engine.enemies.find((enemy) => enemy.type === "swarm");
  engine.fireEnemyBullet(guardian);
  assert.equal(engine.enemyBullets.length, 1);
  engine.killEnemy(guardian);
  assert.equal(engine.enemyBullets.length, 0);
  assert.equal(engine.bulletPool.activeCount, engine.playerBullets.length);
});

test("object pools reuse projectiles after a long synthetic session", () => {
  const engine = makeEngine();
  toPlaying(engine);
  for (let cycle = 0; cycle < 120; cycle += 1) {
    engine.tryFire();
    advance(engine, 0.3, {});
  }
  assert.ok(engine.playerBullets.length <= 3);
  engine.clearEntities();
  assert.equal(engine.playerBullets.length, 0);
  assert.equal(engine.enemyBullets.length, 0);
  assert.equal(engine.bulletPool.activeCount, 0);
  assert.ok(engine.bulletPool.available.length > 0);
});
