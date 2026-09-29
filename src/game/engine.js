import { BONUS_WAVE_DATA, getWaveData } from "../data/waves.js";
import { ObjectPool } from "./pool.js";

export const GAME_STATES = Object.freeze({
  TITLE: "TITLE",
  READY: "READY",
  PLAYING: "PLAYING",
  RESPAWNING: "RESPAWNING",
  PAUSED: "PAUSED",
  WAVE_CLEAR: "WAVE_CLEAR",
  GAME_OVER: "GAME_OVER",
  LOOP_COMPLETE: "LOOP_COMPLETE"
});

export const DEFAULT_CONFIG = Object.freeze({
  width: 960,
  height: 540,
  player: {
    speed: 300,
    fireInterval: 0.22,
    maxBullets: 3,
    lives: 3,
    invincibility: 2,
    respawnDelay: 0.75,
    y: 486,
    hitRadius: 7
  },
  formation: {
    sideMargin: 48,
    maxAttackers: 3,
    warningTime: 0.55,
    minAttackDelay: 1,
    maxAttackDelay: 2.5
  },
  bonus: {
    enabled: true,
    duration: 30
  },
  boss: {
    hp: 40,
    score: 10000
  }
});

export const ENEMY_DEFS = Object.freeze({
  swarm: { hp: 1, score: 50, color: "#55e6ff", label: "SWARM", radius: 13 },
  diver: { hp: 1, score: 100, color: "#ff5c8a", label: "DIVER", radius: 14 },
  guardian: { hp: 2, score: 200, color: "#ffc857", label: "GUARDIAN", radius: 16 },
  commander: { hp: 3, score: 500, color: "#c77dff", label: "COMMANDER", radius: 18 }
});

const STORAGE_KEY = "galaxy-swarm-save-v1";
const EPSILON = 0.000001;

export class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

export function createSafeStorage(storage) {
  const fallback = new MemoryStorage();
  return {
    getItem(key) {
      try {
        return storage?.getItem(key) ?? null;
      } catch {
        return fallback.getItem(key);
      }
    },
    setItem(key, value) {
      try {
        storage?.setItem(key, value);
      } catch {
        // Saving is deliberately best-effort. Gameplay must remain usable.
        fallback.setItem(key, value);
      }
    },
    removeItem(key) {
      try {
        storage?.removeItem(key);
      } catch {
        fallback.removeItem(key);
      }
    }
  };
}

function cloneConfig(overrides = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    player: { ...DEFAULT_CONFIG.player, ...(overrides.player ?? {}) },
    formation: { ...DEFAULT_CONFIG.formation, ...(overrides.formation ?? {}) },
    bonus: { ...DEFAULT_CONFIG.bonus, ...(overrides.bonus ?? {}) },
    boss: { ...DEFAULT_CONFIG.boss, ...(overrides.boss ?? {}) }
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function circleHit(a, b, radiusA, radiusB) {
  const radius = radiusA + radiusB;
  return distanceSquared(a, b) <= radius * radius;
}

function parseSave(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function defaultSettings() {
  return {
    musicVolume: 1,
    sfxVolume: 1,
    screenShake: true,
    flashEffects: true
  };
}

function finiteDt(dt) {
  return Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
}

export class GameEngine {
  constructor({ storage, rng = Math.random, onEvent = () => {}, config = {} } = {}) {
    this.config = cloneConfig(config);
    this.storage = createSafeStorage(storage);
    this.rng = rng;
    this.onEvent = onEvent;
    this.stateLog = [];
    this.score = 0;
    this.highScore = 0;
    this.newHighScore = false;
    this.lives = this.config.player.lives;
    this.wave = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.settings = defaultSettings();
    this.state = GAME_STATES.TITLE;
    this.stateTime = 0;
    this.pauseMenuIndex = 0;
    this.settingsIndex = 0;
    this.settingsOpen = false;
    this.bonus = null;
    this.boss = null;
    this.capturedShip = null;
    this.shakeTimer = 0;
    this.waveClearAwarded = false;
    this.waveResolution = null;
    this.lastEvent = null;
    this.debug = false;
    this.playerBullets = [];
    this.enemyBullets = [];
    this.particles = [];
    this.enemies = [];
    this.formation = this.createFormation();
    this.player = this.createPlayer();
    this.bulletPool = new ObjectPool(
      () => ({ active: false, x: 0, y: 0, vx: 0, vy: 0, radius: 4, owner: "player", ownerId: null }),
      (bullet) => {
        bullet.x = 0;
        bullet.y = 0;
        bullet.vx = 0;
        bullet.vy = 0;
        bullet.ownerId = null;
      }
    );
    this.particlePool = new ObjectPool(
      () => ({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, size: 2, color: "#fff" }),
      (particle) => {
        particle.life = 0;
        particle.maxLife = 0;
      }
    );
    this.loadPersistedData();
  }

  createPlayer() {
    return {
      x: this.config.width / 2,
      y: this.config.player.y,
      width: 28,
      height: 20,
      hitRadius: this.config.player.hitRadius,
      fireCooldown: 0,
      invincible: 0,
      active: true,
      dual: false,
      captured: false
    };
  }

  createFormation() {
    return {
      x: this.config.width / 2,
      y: 92,
      direction: 1,
      speed: 40,
      entry: 0,
      attackCooldown: 1.2,
      attackers: 0,
      left: this.config.formation.sideMargin,
      right: this.config.width - this.config.formation.sideMargin
    };
  }

  loadPersistedData() {
    const save = parseSave(this.storage.getItem(STORAGE_KEY));
    this.highScore = Number.isInteger(save.highScore) && save.highScore >= 0 ? save.highScore : 0;
    this.settings = {
      ...defaultSettings(),
      ...(save.settings ?? {})
    };
    this.settings.musicVolume = clamp(Number(this.settings.musicVolume) || 0, 0, 1);
    this.settings.sfxVolume = clamp(Number(this.settings.sfxVolume) || 0, 0, 1);
    this.settings.screenShake = Boolean(this.settings.screenShake);
    this.settings.flashEffects = Boolean(this.settings.flashEffects);
  }

  persist() {
    this.storage.setItem(STORAGE_KEY, JSON.stringify({
      highScore: this.highScore,
      settings: this.settings
    }));
  }

  emit(type, details = {}) {
    const event = { type, ...details, state: this.state, wave: this.wave, score: this.score };
    this.lastEvent = event;
    this.onEvent(event);
  }

  setState(next, reason = "") {
    if (this.state === next) return;
    const previous = this.state;
    this.state = next;
    // A pause is an overlay, not a new simulation epoch. Preserve the
    // gameplay clock while entering or leaving it so timers cannot jump.
    if (next !== GAME_STATES.PAUSED && previous !== GAME_STATES.PAUSED) this.stateTime = 0;
    this.stateLog.push({ from: previous, to: next, reason });
    if (this.stateLog.length > 100) this.stateLog.shift();
    this.emit("state", { previous, next, reason });
  }

  clearEntities() {
    for (const bullet of this.playerBullets) this.bulletPool.release(bullet);
    for (const bullet of this.enemyBullets) this.bulletPool.release(bullet);
    for (const particle of this.particles) this.particlePool.release(particle);
    this.playerBullets = [];
    this.enemyBullets = [];
    this.particles = [];
    this.enemies = [];
    this.boss = null;
    this.capturedShip = null;
  }

  resetSession({ toTitle = true } = {}) {
    this.clearEntities();
    this.score = 0;
    this.newHighScore = false;
    this.lives = this.config.player.lives;
    this.wave = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.bonus = null;
    this.waveClearAwarded = false;
    this.waveResolution = null;
    this.player = this.createPlayer();
    this.formation = this.createFormation();
    this.pauseMenuIndex = 0;
    this.settingsIndex = 0;
    this.settingsOpen = false;
    if (toTitle) this.setState(GAME_STATES.TITLE, "reset");
  }

  startGame() {
    this.resetSession({ toTitle: false });
    this.emit("gameStart");
    this.startWave(1);
  }

  startWave(number, { bonus = false } = {}) {
    this.clearEntities();
    this.wave = number;
    this.bonus = bonus ? {
      active: true,
      remaining: this.config.bonus.duration,
      kills: 0,
      ended: false
    } : null;
    const data = bonus ? BONUS_WAVE_DATA : getWaveData(number);
    this.formation = this.createFormation();
    this.formation.speed = data.speed;
    this.formation.attackCooldown = data.attackDelay[0];
    this.formation.entry = 0;
    this.waveClearAwarded = false;
    this.waveResolution = null;
    if (data.boss) this.spawnBossWave(data);
    else this.spawnFormation(data.composition, { bonus });
    this.startReady(bonus ? "BONUS" : number);
  }

  startReady(label = this.wave) {
    this.readyLabel = label;
    this.readyTimer = 3;
    this.setState(GAME_STATES.READY, "wave-ready");
    this.emit("waveReady", { label });
  }

  spawnFormation(composition, { bonus = false } = {}) {
    const columns = composition.length > 18 ? 6 : 5;
    const spacingX = 58;
    const spacingY = 34;
    const rowOffset = Math.floor(columns / 2);
    composition.forEach((type, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const offsetX = (column - rowOffset + (columns % 2 === 0 ? 0.5 : 0)) * spacingX;
      const offsetY = row * spacingY;
      this.enemies.push(this.createEnemy(type, index, {
        offsetX,
        offsetY,
        bonus,
        initialState: "entering"
      }));
    });
    this.syncFormationPositions();
  }

  createEnemy(type, index, { offsetX = 0, offsetY = 0, bonus = false, initialState = "formation", isBoss = false } = {}) {
    const definition = ENEMY_DEFS[type] ?? ENEMY_DEFS.swarm;
    return {
      id: `${this.wave}-${type}-${index}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      label: definition.label,
      color: definition.color,
      x: this.config.width / 2 + offsetX,
      y: 80 + offsetY,
      offsetX,
      offsetY,
      radius: definition.radius,
      hp: isBoss ? this.config.boss.hp : definition.hp,
      maxHp: isBoss ? this.config.boss.hp : definition.hp,
      score: isBoss ? this.config.boss.score : definition.score,
      state: initialState,
      alive: true,
      dead: false,
      warningTime: 0,
      diveTime: 0,
      diveStartX: 0,
      diveStartY: 0,
      divePhase: index * 0.7,
      shotTimer: 1.5 + (index % 4) * 0.35,
      hitFlash: 0,
      previousState: initialState,
      bonus,
      isBoss,
      isCaptor: false,
      coreExposed: false,
      coreRadius: 20
    };
  }

  spawnBossWave(data) {
    this.spawnFormation(data.composition, { bonus: false });
    const boss = this.createEnemy("commander", 999, {
      offsetX: 0,
      offsetY: -72,
      initialState: "formation",
      isBoss: true
    });
    boss.id = `boss-${this.wave}`;
    boss.hp = this.config.boss.hp;
    boss.maxHp = this.config.boss.hp;
    boss.score = this.config.boss.score;
    boss.radius = 44;
    boss.coreRadius = 25;
    boss.bossPhase = 1;
    boss.bossDiveTime = 0;
    boss.bossDiveWarning = 0;
    boss.bossAttackTimer = 1;
    this.enemies.push(boss);
    this.boss = boss;
    this.syncFormationPositions();
  }

  syncFormationPositions() {
    const entryAmount = clamp(this.formation.entry, 0, 1);
    const entranceY = lerp(-145, 95, entryAmount * entryAmount * (3 - 2 * entryAmount));
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.state === "diving" || enemy.state === "warning" || enemy.state === "bossDive") continue;
      enemy.x = this.formation.x + enemy.offsetX;
      enemy.y = entranceY + enemy.offsetY;
      if (enemy.state === "entering" && entryAmount >= 1) enemy.state = "formation";
    }
  }

  get aliveEnemies() {
    return this.enemies.filter((enemy) => enemy.alive && !enemy.dead);
  }

  get activeAttackers() {
    return this.enemies.filter((enemy) => enemy.alive && (enemy.state === "warning" || enemy.state === "diving" || enemy.state === "bossDive"));
  }

  get remainingEnemyCount() {
    return this.aliveEnemies.length;
  }

  update(dt, input = {}) {
    dt = finiteDt(dt);
    if (this.state === GAME_STATES.PAUSED || this.state === GAME_STATES.TITLE || this.state === GAME_STATES.GAME_OVER || this.state === GAME_STATES.LOOP_COMPLETE) {
      this.updateParticles(dt, { frozen: this.state === GAME_STATES.PAUSED });
      return;
    }
    this.stateTime += dt;

    if (this.state === GAME_STATES.READY) {
      this.readyTimer = Math.max(0, this.readyTimer - dt);
      if (this.readyTimer <= EPSILON) this.setState(GAME_STATES.PLAYING, "ready-complete");
      return;
    }

    if (this.state === GAME_STATES.WAVE_CLEAR) {
      this.updateWaveClear(dt);
      return;
    }

    this.updateTimers(dt);
    this.updatePlayer(dt, input);
    this.updateFormation(dt);
    this.updateEnemies(dt);
    this.updateBullets(dt);
    this.updateParticles(dt);
    this.checkCollisions();
    this.checkWaveCompletion();
  }

  updateTimers(dt) {
    if (this.shakeTimer > 0) this.shakeTimer = Math.max(0, this.shakeTimer - dt);
    if (this.player.invincible > 0) this.player.invincible = Math.max(0, this.player.invincible - dt);
    if (this.player.fireCooldown > 0) this.player.fireCooldown = Math.max(0, this.player.fireCooldown - dt);
    if (this.comboTimer > 0) {
      this.comboTimer = Math.max(0, this.comboTimer - dt);
      if (this.comboTimer <= EPSILON) this.combo = 0;
    }
    for (const enemy of this.enemies) {
      if (enemy.hitFlash > 0) enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      if (enemy.state === "hit" && enemy.hitFlash <= EPSILON) enemy.state = enemy.previousState ?? "formation";
    }
    if (this.bonus?.active && this.state !== GAME_STATES.WAVE_CLEAR) {
      this.bonus.remaining = Math.max(0, this.bonus.remaining - dt);
      if (this.bonus.remaining <= EPSILON) this.completeBonus("timeout");
    }
  }

  updatePlayer(dt, input) {
    if (!this.player.active) return;
    const axis = (input.left ? -1 : 0) + (input.right ? 1 : 0);
    this.player.x = clamp(
      this.player.x + axis * this.config.player.speed * dt,
      this.player.width / 2,
      this.config.width - this.player.width / 2
    );
    if (input.fire && (this.state === GAME_STATES.PLAYING || this.state === GAME_STATES.RESPAWNING)) this.tryFire();
    if (this.state === GAME_STATES.RESPAWNING) {
      this.respawnTimer = Math.max(0, this.respawnTimer - dt);
      if (this.respawnTimer <= EPSILON) this.setState(GAME_STATES.PLAYING, "respawn-complete");
    }
  }

  tryFire() {
    if (this.player.fireCooldown > EPSILON) return false;
    const shotCount = this.player.dual ? 2 : 1;
    if (this.playerBullets.length + shotCount > this.config.player.maxBullets) return false;
    const offsets = this.player.dual ? [-15, 15] : [0];
    for (const offset of offsets) {
      const bullet = this.bulletPool.acquire();
      bullet.owner = "player";
      bullet.ownerId = null;
      bullet.x = this.player.x + offset;
      bullet.y = this.player.y - 14;
      bullet.vx = 0;
      bullet.vy = -560;
      bullet.radius = 4;
      this.playerBullets.push(bullet);
    }
    this.player.fireCooldown = this.config.player.fireInterval;
    this.emit("playerFire");
    return true;
  }

  updateFormation(dt) {
    if (this.formation.entry < 1) {
      this.formation.entry = clamp(this.formation.entry + dt / 1.8, 0, 1);
      this.syncFormationPositions();
      return;
    }
    const aliveFormationCount = this.enemies.filter((enemy) => enemy.alive && ["formation", "entering"].includes(enemy.state)).length;
    const totalFormationCount = Math.max(1, this.enemies.filter((enemy) => !enemy.isBoss).length);
    const speedMultiplier = aliveFormationCount / totalFormationCount <= 0.25 ? 1.15 : 1;
    this.formation.x += this.formation.direction * this.formation.speed * speedMultiplier * dt;
    const alive = this.aliveEnemies.filter((enemy) => !enemy.isBoss);
    const minOffset = alive.length ? Math.min(...alive.map((enemy) => enemy.offsetX)) : -250;
    const maxOffset = alive.length ? Math.max(...alive.map((enemy) => enemy.offsetX)) : 250;
    if (this.formation.x + maxOffset >= this.formation.right) {
      this.formation.x = this.formation.right - maxOffset;
      this.formation.direction = -1;
    } else if (this.formation.x + minOffset <= this.formation.left) {
      this.formation.x = this.formation.left - minOffset;
      this.formation.direction = 1;
    }
    this.syncFormationPositions();
  }

  updateEnemies(dt) {
    const data = this.bonus ? BONUS_WAVE_DATA : getWaveData(this.wave);
    const formationReady = this.formation.entry >= 1;

    if (formationReady && !this.bonus?.active) {
      this.formation.attackCooldown -= dt;
      if (this.formation.attackCooldown <= EPSILON && this.activeAttackers.length < this.config.formation.maxAttackers) {
        const available = this.enemies.filter((enemy) => enemy.alive && enemy.state === "formation" && !enemy.isBoss);
        if (available.length) {
          const attacker = available[Math.floor(this.rng() * available.length) % available.length];
          attacker.state = "warning";
          attacker.warningTime = this.config.formation.warningTime;
          attacker.diveStartX = attacker.x;
          attacker.diveStartY = attacker.y;
          this.emit("attackWarning", { enemyType: attacker.type, enemyId: attacker.id });
          const commanderFactor = this.enemies.some((enemy) => enemy.alive && enemy.type === "commander" && !enemy.isBoss) ? 0.82 : 1;
          this.formation.attackCooldown = this.randomBetween(data.attackDelay[0], data.attackDelay[1]) * commanderFactor;
        } else {
          this.formation.attackCooldown = 0.5;
        }
      }
    }

    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      if (enemy.state === "warning") {
        enemy.warningTime = Math.max(0, enemy.warningTime - dt);
        if (enemy.warningTime <= EPSILON) {
          enemy.state = "diving";
          enemy.diveTime = 0;
          this.formation.attackers += 1;
          this.emit("attackStart", { enemyType: enemy.type, enemyId: enemy.id });
        }
      } else if (enemy.state === "diving") {
        this.updateDivingEnemy(enemy, dt);
      } else if (enemy.isBoss) {
        this.updateBoss(enemy, dt);
      } else if (formationReady && enemy.type === "guardian") {
        enemy.shotTimer -= dt;
        if (enemy.shotTimer <= EPSILON && this.enemyBullets.length < 30) {
          this.fireEnemyBullet(enemy);
          enemy.shotTimer = Math.max(1.2, 2.8 - this.wave * 0.12);
        }
      }
    }
  }

  randomBetween(min, max) {
    return min + (max - min) * clamp(this.rng(), 0, 0.999999);
  }

  updateDivingEnemy(enemy, dt) {
    enemy.diveTime += dt;
    const t = enemy.diveTime;
    const curveAmount = enemy.type === "diver" ? 145 : enemy.type === "commander" ? 82 : 58;
    enemy.x = enemy.diveStartX + Math.sin(t * 2.4 + enemy.divePhase) * curveAmount;
    enemy.y = enemy.diveStartY + t * (enemy.type === "diver" ? 185 : 155);
    if (enemy.type === "commander" && this.wave >= 7 && !this.capturedShip && t > 0.55 && t < 1.6) {
      if (circleHit(enemy, this.player, enemy.radius, this.player.hitRadius + 10)) this.capturePlayer(enemy);
    }
    if (enemy.type === "guardian" && enemy.shotTimer <= EPSILON && this.enemyBullets.length < 30) {
      this.fireEnemyBullet(enemy);
      enemy.shotTimer = 1.8;
    }
    if (enemy.y > this.config.height + 60 || t > 4.8) {
      enemy.alive = false;
      enemy.dead = true;
      enemy.state = "escaped";
      for (let index = this.enemyBullets.length - 1; index >= 0; index -= 1) {
        if (this.enemyBullets[index].ownerId === enemy.id) this.releaseBullet(this.enemyBullets, index);
      }
      if (enemy.isCaptor && this.capturedShip?.commanderId === enemy.id) this.loseCapturedShip();
      this.formation.attackers = Math.max(0, this.formation.attackers - 1);
      this.emit("enemyEscaped", { enemyType: enemy.type, enemyId: enemy.id });
    }
  }

  updateBoss(boss, dt) {
    const nextPhase = boss.hp <= 10 ? 3 : boss.hp <= 20 ? 2 : 1;
    if (nextPhase !== boss.bossPhase) {
      boss.bossPhase = nextPhase;
      boss.coreExposed = nextPhase >= 2;
      this.emit("bossPhase", { phase: nextPhase });
    }
    boss.coreExposed = boss.bossPhase >= 2;
    boss.bossAttackTimer -= dt;
    if (boss.bossAttackTimer <= EPSILON && this.enemyBullets.length < 30) {
      this.fireEnemyBullet(boss, { spread: boss.bossPhase + 1 });
      boss.bossAttackTimer = boss.bossPhase === 1 ? 1.35 : boss.bossPhase === 2 ? 0.9 : 0.65;
    }
    if (boss.bossPhase >= 3) {
      if (boss.bossDiveWarning > 0) {
        boss.bossDiveWarning = Math.max(0, boss.bossDiveWarning - dt);
        if (boss.bossDiveWarning <= EPSILON) {
          boss.state = "bossDive";
          boss.bossDiveTime = 0;
          this.emit("bossDive");
        }
      } else if (boss.state !== "bossDive" && boss.bossDiveTime <= EPSILON) {
        boss.bossDiveWarning = 0.55;
        this.emit("attackWarning", { enemyType: "boss", enemyId: boss.id });
      } else if (boss.state === "bossDive") {
        boss.bossDiveTime += dt;
        const t = boss.bossDiveTime;
        boss.x = this.formation.x + Math.sin(t * 2) * 70;
        boss.y = 95 + t * 130;
        if (t > 1.1 || boss.y > this.config.height - 90) {
          boss.state = "formation";
          boss.bossDiveTime = 0;
          this.syncFormationPositions();
        }
      }
    }
  }

  fireEnemyBullet(enemy, { spread = 1 } = {}) {
    if (this.enemyBullets.length >= 30) return false;
    const targets = spread >= 3 ? [-0.28, 0, 0.28] : spread === 2 ? [-0.12, 0.12] : [0];
    for (const angleOffset of targets) {
      if (this.enemyBullets.length >= 30) break;
      const bullet = this.bulletPool.acquire();
      const dx = this.player.x - enemy.x;
      const dy = this.player.y - enemy.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const speed = 165 + this.wave * 5;
      const baseAngle = Math.atan2(dy, dx) + angleOffset;
      bullet.owner = "enemy";
      bullet.ownerId = enemy.id;
      bullet.x = enemy.x;
      bullet.y = enemy.y + enemy.radius * 0.5;
      bullet.vx = Math.cos(baseAngle) * speed;
      bullet.vy = Math.sin(baseAngle) * speed;
      bullet.radius = 5;
      this.enemyBullets.push(bullet);
    }
    this.emit("enemyFire", { enemyType: enemy.type });
    return true;
  }

  updateBullets(dt) {
    for (let index = this.playerBullets.length - 1; index >= 0; index -= 1) {
      const bullet = this.playerBullets[index];
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      if (bullet.y < -20 || bullet.x < -20 || bullet.x > this.config.width + 20) this.releaseBullet(this.playerBullets, index);
    }
    for (let index = this.enemyBullets.length - 1; index >= 0; index -= 1) {
      const bullet = this.enemyBullets[index];
      const owner = this.enemies.find((enemy) => enemy.id === bullet.ownerId);
      if (!owner?.alive) {
        this.releaseBullet(this.enemyBullets, index);
        continue;
      }
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      if (bullet.y < -30 || bullet.y > this.config.height + 30 || bullet.x < -30 || bullet.x > this.config.width + 30) this.releaseBullet(this.enemyBullets, index);
    }
  }

  releaseBullet(collection, index) {
    const [bullet] = collection.splice(index, 1);
    this.bulletPool.release(bullet);
  }

  spawnParticles(x, y, color, count = 8) {
    if (this.settings.flashEffects === false) count = Math.min(count, 3);
    for (let i = 0; i < count; i += 1) {
      const particle = this.particlePool.acquire();
      const angle = (Math.PI * 2 * i) / count + this.rng() * 0.3;
      const speed = 25 + this.rng() * 85;
      particle.x = x;
      particle.y = y;
      particle.vx = Math.cos(angle) * speed;
      particle.vy = Math.sin(angle) * speed;
      particle.life = 0.35 + this.rng() * 0.35;
      particle.maxLife = particle.life;
      particle.size = 1.5 + this.rng() * 2.5;
      particle.color = color;
      this.particles.push(particle);
    }
  }

  updateParticles(dt, { frozen = false } = {}) {
    if (frozen) return;
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= 0.98;
      particle.vy *= 0.98;
      if (particle.life <= EPSILON) {
        const [removed] = this.particles.splice(index, 1);
        this.particlePool.release(removed);
      }
    }
  }

  checkCollisions() {
    this.checkPlayerBullets();
    this.checkEnemyBullets();
    this.checkEnemyBodies();
  }

  checkPlayerBullets() {
    for (let bulletIndex = this.playerBullets.length - 1; bulletIndex >= 0; bulletIndex -= 1) {
      const bullet = this.playerBullets[bulletIndex];
      let hit = false;
      for (const enemy of this.enemies) {
        if (!enemy.alive) continue;
        const targetRadius = enemy.isBoss ? enemy.coreRadius : enemy.radius;
        if (!circleHit(bullet, enemy, bullet.radius, targetRadius)) continue;
        if (enemy.isBoss && !this.isBossCoreHit(bullet, enemy)) continue;
        this.damageEnemy(enemy, 1);
        hit = true;
        break;
      }
      if (hit) this.releaseBullet(this.playerBullets, bulletIndex);
    }
  }

  isBossCoreHit(bullet, boss) {
    return circleHit(bullet, boss, bullet.radius, boss.coreRadius);
  }

  checkEnemyBullets() {
    if (!this.player.active) return;
    for (let index = this.enemyBullets.length - 1; index >= 0; index -= 1) {
      const bullet = this.enemyBullets[index];
      if (circleHit(bullet, this.player, bullet.radius, this.player.hitRadius)) {
        this.releaseBullet(this.enemyBullets, index);
        this.handlePlayerHit({ source: "enemy-bullet" });
        if (this.state === GAME_STATES.WAVE_CLEAR || this.state === GAME_STATES.GAME_OVER) break;
      }
    }
  }

  checkEnemyBodies() {
    if (!this.player.active || this.player.invincible > EPSILON) return;
    for (const enemy of this.enemies) {
      if (!enemy.alive || !["diving", "bossDive"].includes(enemy.state)) continue;
      if (circleHit(enemy, this.player, enemy.radius, this.player.hitRadius)) {
        if (enemy.type === "commander" && !enemy.isBoss && this.wave >= 7 && !this.capturedShip) this.capturePlayer(enemy);
        else this.handlePlayerHit({ source: "enemy-body", enemyType: enemy.type });
        break;
      }
    }
  }

  damageEnemy(enemy, amount = 1) {
    if (!enemy?.alive || enemy.dead) return false;
    enemy.hp = Math.max(0, enemy.hp - Math.max(0, Math.floor(amount)));
    enemy.hitFlash = 0.12;
    enemy.previousState = enemy.state;
    if (enemy.hp > 0) enemy.state = "hit";
    this.spawnParticles(enemy.x, enemy.y, enemy.color, enemy.isBoss ? 5 : 4);
    this.emit("enemyHit", { enemyType: enemy.type, enemyId: enemy.id, hp: enemy.hp });
    if (enemy.hp <= 0) this.killEnemy(enemy);
    return true;
  }

  killEnemy(enemy) {
    if (!enemy?.alive || enemy.dead) return false;
    enemy.dead = true;
    enemy.alive = false;
    enemy.state = "dead";
    for (let index = this.enemyBullets.length - 1; index >= 0; index -= 1) {
      if (this.enemyBullets[index].ownerId === enemy.id) this.releaseBullet(this.enemyBullets, index);
    }
    this.spawnParticles(enemy.x, enemy.y, enemy.color, enemy.isBoss ? 24 : 10);
    if (enemy.isBoss) {
      this.completeBoss();
      return true;
    }
    if (this.bonus?.active) {
      this.bonus.kills += 1;
      this.emit("bonusKill", { enemyType: enemy.type, kills: this.bonus.kills });
    } else {
      this.registerKill(enemy.score, enemy.type);
    }
    if (enemy.isCaptor && this.capturedShip) this.rescuePlayer(enemy);
    this.emit("enemyDefeated", { enemyType: enemy.type, enemyId: enemy.id });
    return true;
  }

  comboMultiplier(value = this.combo) {
    if (value >= 10) return 5;
    if (value >= 7) return 4;
    if (value >= 4) return 3;
    if (value >= 2) return 2;
    return 1;
  }

  registerKill(baseScore, enemyType) {
    this.combo = this.comboTimer > EPSILON ? this.combo + 1 : 1;
    this.comboTimer = 2;
    const multiplier = this.comboMultiplier(this.combo);
    this.addScore(baseScore * multiplier, { combo: false, reason: "enemy-kill", baseScore, multiplier });
    this.emit("combo", { count: this.combo, multiplier, enemyType });
  }

  addScore(amount, { combo = false, reason = "score", baseScore = amount, multiplier = 1 } = {}) {
    const safeAmount = Math.max(0, Math.round(Number(amount) || 0));
    this.score = Math.max(0, Math.round(this.score + safeAmount));
    if (this.score > this.highScore) {
      this.highScore = this.score;
      this.newHighScore = true;
      this.persist();
      this.emit("newHighScore", { value: this.highScore });
    }
    this.emit("score", { amount: safeAmount, baseScore, multiplier, combo, reason });
  }

  capturePlayer(commander) {
    if (this.capturedShip || !this.player.active || this.player.invincible > EPSILON) return false;
    this.capturedShip = {
      x: commander.x,
      y: commander.y + 23,
      commanderId: commander.id,
      active: true
    };
    commander.isCaptor = true;
    this.player.captured = true;
    this.player.active = true;
    this.player.invincible = 2;
    this.emit("capture", { commanderId: commander.id });
    this.respawnTimer = this.config.player.respawnDelay;
    this.setState(GAME_STATES.RESPAWNING, "captured");
    return true;
  }

  rescuePlayer(commander) {
    if (!this.capturedShip || this.capturedShip.commanderId !== commander.id) return false;
    this.capturedShip = null;
    this.player.captured = false;
    this.player.dual = true;
    this.emit("rescue");
    return true;
  }

  loseCapturedShip() {
    if (!this.capturedShip) return;
    this.capturedShip = null;
    this.player.captured = false;
    this.emit("capturedShipLost");
  }

  handlePlayerHit({ source = "unknown", enemyType = null } = {}) {
    if (this.player.invincible > EPSILON || !this.player.active) return false;
    if (this.bonus?.active && !this.bonus.ended) {
      this.bonus.ended = true;
      this.emit("bonusEnd", { reason: "hit" });
      this.completeBonus("hit");
      return true;
    }
    this.player.invincible = this.config.player.invincibility;
    this.shakeTimer = 0.25;
    this.combo = 0;
    this.comboTimer = 0;
    if (this.capturedShip) this.loseCapturedShip();
    this.lives = Math.max(0, this.lives - 1);
    this.emit("playerHit", { source, enemyType, lives: this.lives });
    this.spawnParticles(this.player.x, this.player.y, "#ffffff", 14);
    if (this.lives <= 0) {
      this.player.active = false;
      this.clearEntities();
      this.setState(GAME_STATES.GAME_OVER, "no-lives");
      this.persist();
      this.emit("gameOver");
    } else {
      this.respawnTimer = this.config.player.respawnDelay;
      this.setState(GAME_STATES.RESPAWNING, "player-hit");
    }
    return true;
  }

  checkWaveCompletion() {
    if (this.state !== GAME_STATES.PLAYING && this.state !== GAME_STATES.RESPAWNING) return;
    if (this.bonus?.active) {
      if (!this.bonus.ended && this.remainingEnemyCount === 0) this.completeBonus("cleared");
      return;
    }
    if (this.boss) return;
    if (this.remainingEnemyCount === 0 && !this.waveResolution) this.completeWave();
  }

  completeWave() {
    if (this.waveResolution) return false;
    this.waveResolution = "wave";
    this.waveClearAwarded = true;
    const reward = this.wave * 500;
    this.addScore(reward, { combo: false, reason: "wave-clear", baseScore: reward, multiplier: 1 });
    this.emit("waveClear", { reward });
    this.beginWaveClear({ reason: "wave", nextWave: this.wave + 1 });
    return true;
  }

  completeBonus(reason = "timeout") {
    if (!this.bonus || this.bonus.ended && this.waveResolution === "bonus") return false;
    this.bonus.ended = true;
    const bonusScore = this.bonus.kills * 100;
    this.addScore(bonusScore, { combo: false, reason: "bonus-clear", baseScore: bonusScore, multiplier: 1 });
    for (const enemy of this.enemies) {
      enemy.alive = false;
      enemy.dead = true;
    }
    this.waveResolution = "bonus";
    this.emit("bonusClear", { reason, kills: this.bonus.kills, reward: bonusScore });
    this.beginWaveClear({ reason: "bonus", nextWave: 6 });
    return true;
  }

  completeBoss() {
    if (!this.boss || this.state === GAME_STATES.LOOP_COMPLETE) return false;
    this.boss.dead = true;
    this.boss.alive = false;
    for (const enemy of this.enemies) {
      enemy.dead = true;
      enemy.alive = false;
    }
    for (let index = this.enemyBullets.length - 1; index >= 0; index -= 1) this.releaseBullet(this.enemyBullets, index);
    this.registerKill(this.config.boss.score, "boss");
    this.emit("bossDefeated", { reward: this.config.boss.score });
    this.persist();
    this.setState(GAME_STATES.LOOP_COMPLETE, "boss-defeated");
    return true;
  }

  beginWaveClear({ reason, nextWave }) {
    this.waveResolution = reason;
    this.nextWave = nextWave;
    this.clearTimer = 2;
    this.setState(GAME_STATES.WAVE_CLEAR, reason);
  }

  updateWaveClear(dt) {
    this.clearTimer = Math.max(0, this.clearTimer - dt);
    if (this.clearTimer > EPSILON) return;
    if (this.waveResolution === "bonus") this.startWave(this.nextWave, { bonus: false });
    else if (this.wave === 5 && this.config.bonus.enabled) this.startWave(5, { bonus: true });
    else if (this.nextWave <= 10) this.startWave(this.nextWave);
    else this.setState(GAME_STATES.LOOP_COMPLETE, "all-waves-complete");
  }

  togglePause() {
    if ([GAME_STATES.PLAYING, GAME_STATES.RESPAWNING, GAME_STATES.READY].includes(this.state)) {
      this.pausedFrom = this.state;
      this.setState(GAME_STATES.PAUSED, "pause");
      this.pauseMenuIndex = 0;
      this.settingsOpen = false;
      this.emit("pause");
      return true;
    }
    if (this.state === GAME_STATES.PAUSED && !this.settingsOpen) {
      this.setState(this.pausedFrom ?? GAME_STATES.PLAYING, "resume");
      this.emit("resume");
      return true;
    }
    return false;
  }

  handleKeyDown(code) {
    if (code === "KeyP" || code === "Escape") {
      if ([GAME_STATES.PLAYING, GAME_STATES.RESPAWNING, GAME_STATES.READY].includes(this.state)) return this.togglePause();
      if (this.state === GAME_STATES.PAUSED && !this.settingsOpen) return this.togglePause();
      if (this.state === GAME_STATES.PAUSED && this.settingsOpen) {
        this.settingsOpen = false;
        return true;
      }
    }
    if (this.state === GAME_STATES.TITLE && ["Enter", "Space"].includes(code)) {
      this.startGame();
      return true;
    }
    if (this.state === GAME_STATES.GAME_OVER) {
      if (code === "ArrowUp" || code === "ArrowDown") {
        this.gameOverMenuIndex = ((this.gameOverMenuIndex ?? 0) + (code === "ArrowDown" ? 1 : -1) + 2) % 2;
        return true;
      }
      if (["Enter", "Space"].includes(code)) {
        if ((this.gameOverMenuIndex ?? 0) === 0) this.startGame();
        else this.resetSession({ toTitle: true });
        return true;
      }
    }
    if (this.state === GAME_STATES.PAUSED) return this.handlePauseMenuKey(code);
    if (this.state === GAME_STATES.LOOP_COMPLETE) {
      if (["Enter", "Space"].includes(code)) {
        this.startGame();
        return true;
      }
      if (code === "Escape") {
        this.resetSession({ toTitle: true });
        return true;
      }
    }
    return false;
  }

  handlePauseMenuKey(code) {
    if (this.settingsOpen) {
      if (code === "ArrowUp" || code === "ArrowDown") {
        this.settingsIndex = clamp(this.settingsIndex + (code === "ArrowDown" ? 1 : -1), 0, 3);
        return true;
      }
      if (code === "ArrowLeft" || code === "ArrowRight") {
        this.adjustSetting(code === "ArrowRight" ? 0.1 : -0.1);
        return true;
      }
      if (["Enter", "Space"].includes(code)) {
        this.settingsOpen = false;
        return true;
      }
      return false;
    }
    if (code === "ArrowUp" || code === "ArrowDown") {
      this.pauseMenuIndex = clamp(this.pauseMenuIndex + (code === "ArrowDown" ? 1 : -1), 0, 2);
      return true;
    }
    if (["Enter", "Space"].includes(code)) {
      if (this.pauseMenuIndex === 0) this.togglePause();
      else if (this.pauseMenuIndex === 1) {
        this.settingsOpen = true;
        this.settingsIndex = 0;
      } else this.resetSession({ toTitle: true });
      return true;
    }
    return false;
  }

  adjustSetting(delta) {
    const step = Number.isFinite(delta) ? delta : 0;
    if (this.settingsIndex === 0) this.settings.musicVolume = clamp(Math.round((this.settings.musicVolume + step) * 10) / 10, 0, 1);
    else if (this.settingsIndex === 1) this.settings.sfxVolume = clamp(Math.round((this.settings.sfxVolume + step) * 10) / 10, 0, 1);
    else if (this.settingsIndex === 2) this.settings.screenShake = !this.settings.screenShake;
    else this.settings.flashEffects = !this.settings.flashEffects;
    this.persist();
    this.emit("settingsChanged", { settings: { ...this.settings } });
  }

  getStatusText() {
    if (this.state === GAME_STATES.TITLE) return `TITLE. Press Enter or Space to start. High score ${this.highScore}.`;
    if (this.state === GAME_STATES.READY) return `${this.readyLabel === "BONUS" ? "Bonus wave" : `Wave ${this.readyLabel}`} begins in ${Math.ceil(this.readyTimer)}.`;
    if (this.state === GAME_STATES.PLAYING || this.state === GAME_STATES.RESPAWNING) return `Playing wave ${this.wave}. Score ${this.score}. Lives ${this.lives}. Combo ${this.combo}.`;
    if (this.state === GAME_STATES.PAUSED) return this.settingsOpen ? "Paused settings. Use arrows to change a setting." : "Paused. Choose continue, settings, or title.";
    if (this.state === GAME_STATES.WAVE_CLEAR) return `Wave ${this.wave} clear. Next wave ${this.nextWave}.`;
    if (this.state === GAME_STATES.GAME_OVER) return `Game over. Final score ${this.score}.`;
    return `Loop complete. Final score ${this.score}. Press Enter to play again.`;
  }

  getSnapshot() {
    return {
      state: this.state,
      score: this.score,
      highScore: this.highScore,
      lives: this.lives,
      wave: this.wave,
      combo: this.combo,
      comboTimer: this.comboTimer,
      player: { ...this.player },
      enemyCount: this.remainingEnemyCount,
      activeAttackers: this.activeAttackers.length,
      playerBullets: this.playerBullets.length,
      enemyBullets: this.enemyBullets.length,
      bonus: this.bonus ? { ...this.bonus } : null,
      boss: this.boss ? { hp: this.boss.hp, phase: this.boss.bossPhase, coreExposed: this.boss.coreExposed } : null,
      settings: { ...this.settings }
    };
  }
}
