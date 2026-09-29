import { GAME_STATES, GameEngine } from "./game/engine.js";

const WIDTH = 960;
const HEIGHT = 540;
const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const liveStatus = document.querySelector("#live-status");
const debug = new URLSearchParams(window.location.search).has("debug");

class AudioManager {
  constructor() {
    this.context = null;
    this.musicGain = null;
    this.musicOscillator = null;
    this.musicTimer = null;
    this.lastMusicStep = 0;
  }

  ensureContext() {
    if (this.context) {
      if (this.context.state === "suspended") this.context.resume().catch(() => {});
      return this.context;
    }
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      this.context = new AudioContext();
      this.musicGain = this.context.createGain();
      this.musicGain.gain.value = 0;
      this.musicGain.connect(this.context.destination);
      return this.context;
    } catch {
      this.context = null;
      return null;
    }
  }

  tone(frequency, duration = 0.08, type = "square", volume = 0.12) {
    const audio = this.ensureContext();
    if (!audio) return;
    try {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(Math.max(0.0001, volume), audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + duration + 0.02);
    } catch {
      // Audio is an enhancement; browser autoplay and device failures are safe.
    }
  }

  startMusic(engine) {
    const audio = this.ensureContext();
    if (!audio || this.musicTimer) return;
    this.musicGain.gain.setTargetAtTime(0.035 * engine.settings.musicVolume, audio.currentTime, 0.05);
    this.musicTimer = window.setInterval(() => {
      if (!this.context || engine.state === GAME_STATES.PAUSED || engine.state === GAME_STATES.TITLE) return;
      const notes = [110, 146.83, 164.81, 220, 164.81, 146.83];
      this.tone(notes[this.lastMusicStep++ % notes.length], 0.18, "triangle", 0.025 * engine.settings.musicVolume);
    }, 320);
  }

  stopMusic() {
    if (this.musicTimer) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
    if (this.musicGain && this.context) this.musicGain.gain.setTargetAtTime(0, this.context.currentTime, 0.04);
  }

  handle(event, engine) {
    const sfxVolume = engine.settings.sfxVolume;
    if (["gameStart", "waveReady"].includes(event.type)) this.tone(440, 0.12, "square", 0.12 * sfxVolume);
    else if (event.type === "playerFire") this.tone(760, 0.045, "square", 0.055 * sfxVolume);
    else if (event.type === "enemyHit") this.tone(190, 0.05, "sawtooth", 0.045 * sfxVolume);
    else if (event.type === "enemyDefeated") this.tone(280 + (event.enemyType === "commander" ? 130 : 0), 0.1, "square", 0.1 * sfxVolume);
    else if (event.type === "playerHit") this.tone(90, 0.22, "sawtooth", 0.18 * sfxVolume);
    else if (event.type === "waveClear") this.tone(660, 0.18, "triangle", 0.12 * sfxVolume);
    else if (event.type === "capture") this.tone(120, 0.3, "sawtooth", 0.13 * sfxVolume);
    else if (event.type === "rescue") this.tone(880, 0.24, "triangle", 0.16 * sfxVolume);
    else if (event.type === "bonusClear") this.tone(990, 0.24, "triangle", 0.14 * sfxVolume);
    else if (event.type === "bossPhase") this.tone(210 + event.phase * 55, 0.3, "sawtooth", 0.13 * sfxVolume);
    else if (event.type === "bossDefeated") this.tone(1320, 0.6, "triangle", 0.18 * sfxVolume);
    else if (event.type === "newHighScore") this.tone(1046, 0.35, "triangle", 0.18 * sfxVolume);
    else if (event.type === "pause") this.stopMusic();
    else if (event.type === "resume") this.startMusic(engine);
    if (["gameStart", "resume", "waveReady"].includes(event.type)) this.startMusic(engine);
  }
}

const audio = new AudioManager();
const safeLocalStorage = (() => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
})();

const engine = new GameEngine({
  storage: safeLocalStorage,
  onEvent: (event) => {
    audio.handle(event, engine);
    liveStatus.textContent = engine.getStatusText();
  }
});

const input = {
  left: false,
  right: false,
  fire: false,
  clear() {
    this.left = false;
    this.right = false;
    this.fire = false;
  },
  snapshot() {
    return { left: this.left, right: this.right, fire: this.fire };
  }
};

function isGameKey(code) {
  return ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "Enter", "KeyA", "KeyD", "KeyZ", "KeyP", "Escape"].includes(code);
}

window.addEventListener("keydown", (event) => {
  const code = event.code;
  if (isGameKey(code)) event.preventDefault();
  if (code === "ArrowLeft" || code === "KeyA") input.left = true;
  if (code === "ArrowRight" || code === "KeyD") input.right = true;
  if (code === "Space" || code === "KeyZ") input.fire = true;
  engine.handleKeyDown(code);
  canvas.focus({ preventScroll: true });
});

window.addEventListener("keyup", (event) => {
  if (event.code === "ArrowLeft" || event.code === "KeyA") input.left = false;
  if (event.code === "ArrowRight" || event.code === "KeyD") input.right = false;
  if (event.code === "Space" || event.code === "KeyZ") input.fire = false;
});

window.addEventListener("blur", () => input.clear());
document.addEventListener("visibilitychange", () => {
  input.clear();
  if (document.hidden && [GAME_STATES.PLAYING, GAME_STATES.RESPAWNING, GAME_STATES.READY].includes(engine.state)) engine.togglePause();
});

const stars = Array.from({ length: 100 }, (_, index) => ({
  x: (index * 83) % WIDTH,
  y: (index * 137) % HEIGHT,
  size: 0.5 + (index % 4) * 0.45,
  alpha: 0.18 + (index % 7) * 0.08,
  phase: index * 0.37
}));

const spriteSheets = {
  player: new Image(),
  enemies: null,
  vfx: new Image()
};
const spriteRoot = new URL("../assets/sprites/", import.meta.url);
spriteSheets.player.src = new URL("player/player-sheet.png", spriteRoot).href;
spriteSheets.vfx.src = new URL("vfx/vfx-sheet.png", spriteRoot).href;

function removeCheckerboardBackground(image) {
  const surface = document.createElement("canvas");
  surface.width = image.naturalWidth;
  surface.height = image.naturalHeight;
  const surfaceContext = surface.getContext("2d", { willReadFrequently: true });
  if (!surfaceContext || !surface.width || !surface.height) return null;

  surfaceContext.drawImage(image, 0, 0);
  const pixels = surfaceContext.getImageData(0, 0, surface.width, surface.height);
  const data = pixels.data;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const brightness = (red + green + blue) / 3;
    const colorSpread = Math.max(red, green, blue) - Math.min(red, green, blue);

    // The generated sheet contains a gray transparency checkerboard. Its
    // near-neutral midtones are distinct from the saturated enemy art.
    if (brightness >= 105 && brightness <= 238 && colorSpread <= 12) data[index + 3] = 0;
  }
  surfaceContext.putImageData(pixels, 0, 0);
  return surface;
}

function repairEnemySheetFrameBleed(sheet) {
  if (!sheet) return null;

  const cellSize = 64;
  const commanderColumn = 3;
  const guardianColumn = commanderColumn - 1;
  const leftBleed = 14;
  const rightPaddingTrim = 6;
  const commanderFrameWidth = cellSize + leftBleed - rightPaddingTrim;
  const frameCount = Math.floor(sheet.height / cellSize);
  const repaired = document.createElement("canvas");
  repaired.width = sheet.width;
  repaired.height = sheet.height;

  const context = repaired.getContext("2d");
  if (!context) return sheet;
  context.drawImage(sheet, 0, 0);

  for (let row = 0; row < frameCount; row += 1) {
    const y = row * cellSize;
    const guardianRightEdge = (guardianColumn + 1) * cellSize - leftBleed;
    const commanderX = commanderColumn * cellSize;
    const commanderSourceX = commanderX - leftBleed;

    // The purple commander art spills into the guardian cell, while its far
    // right edge has unused padding. Recenter the wider source span into its
    // own 64px cell so neither enemy is cut at the atlas boundary.
    context.clearRect(guardianRightEdge, y, leftBleed, cellSize);
    context.clearRect(commanderX, y, cellSize, cellSize);
    context.drawImage(
      sheet,
      commanderSourceX,
      y,
      commanderFrameWidth,
      cellSize,
      commanderX,
      y,
      cellSize,
      cellSize,
    );
  }

  return repaired;
}

const enemySheetImage = new Image();
enemySheetImage.addEventListener("load", () => {
  spriteSheets.enemies = repairEnemySheetFrameBleed(removeCheckerboardBackground(enemySheetImage));
}, { once: true });
enemySheetImage.src = new URL("enemies/enemies-sheet.png", spriteRoot).href;

function drawSprite(sheet, column, row, x, y, size = 64, alpha = 1) {
  if (!sheet || !(sheet.naturalWidth || sheet.width)) return false;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(sheet, column * 64, row * 64, 64, 64, x - size / 2, y - size / 2, size, size);
  ctx.restore();
  return true;
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function text(value, x, y, size, color = "#d9f5ff", align = "left", weight = 600) {
  ctx.font = `${weight} ${size}px "Trebuchet MS", "Segoe UI", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
}

function outlinedText(value, x, y, size, color = "#d9f5ff", align = "center", weight = 800) {
  ctx.font = `${weight} ${size}px "Trebuchet MS", "Segoe UI", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.lineWidth = Math.max(2, size * 0.12);
  ctx.strokeStyle = "rgba(1, 5, 15, 0.95)";
  ctx.strokeText(value, x, y);
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
}

function drawBackground(now) {
  const theme = engine.bonus?.active ? "#321c6a" : engine.wave >= 7 ? "#241044" : engine.wave >= 4 ? "#112c4b" : "#071226";
  const gradient = ctx.createRadialGradient(WIDTH / 2, 140, 15, WIDTH / 2, 260, 570);
  gradient.addColorStop(0, theme);
  gradient.addColorStop(1, "#02040d");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  for (const star of stars) {
    const pulse = 0.7 + Math.sin(now / 800 + star.phase) * 0.3;
    ctx.globalAlpha = star.alpha * pulse;
    ctx.fillStyle = star.size > 1.5 ? "#b6f1ff" : "#6d9abb";
    ctx.fillRect(star.x, star.y, star.size, star.size);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(89, 194, 255, 0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(48, 0);
  ctx.lineTo(48, HEIGHT);
  ctx.moveTo(WIDTH - 48, 0);
  ctx.lineTo(WIDTH - 48, HEIGHT);
  ctx.stroke();
}

function drawHud() {
  if (!engine.wave) return;
  text("1UP", 28, 24, 12, "#55e6ff");
  text(String(engine.score).padStart(7, "0"), 28, 43, 20, "#eafaff");
  text(`WAVE ${engine.wave}${engine.bonus?.active ? " · BONUS" : ""}`, WIDTH / 2, 28, 15, engine.bonus?.active ? "#ffc857" : "#d9f5ff", "center", 800);
  text("HIGH SCORE", WIDTH - 28, 24, 12, "#c77dff", "right");
  text(String(engine.highScore).padStart(7, "0"), WIDTH - 28, 43, 20, "#f6e9ff", "right");

  text("LIVES", 28, HEIGHT - 28, 11, "#8faec5");
  for (let index = 0; index < engine.lives; index += 1) drawShip(74 + index * 23, HEIGHT - 29, 0.55, "#55e6ff", false);
  text(`COMBO x${engine.comboMultiplier()}`, WIDTH - 28, HEIGHT - 40, 13, engine.combo > 1 ? "#ffc857" : "#8faec5", "right", 800);
  if (engine.combo > 0) text(`${engine.combo} CHAIN`, WIDTH - 28, HEIGHT - 22, 11, "#b9d7e6", "right");
  if (engine.bonus?.active) {
    const ratio = Math.max(0, engine.bonus.remaining / 30);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(WIDTH / 2 - 110, 52, 220, 4);
    ctx.fillStyle = "#ffc857";
    ctx.fillRect(WIDTH / 2 - 110, 52, 220 * ratio, 4);
    text(`${Math.ceil(engine.bonus.remaining)}s`, WIDTH / 2 + 122, 54, 11, "#ffc857", "left");
  }
}

function drawShip(x, y, scale = 1, color = "#55e6ff", glow = true) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  if (glow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -17);
  ctx.lineTo(8, 8);
  ctx.lineTo(22, 14);
  ctx.lineTo(8, 14);
  ctx.lineTo(0, 10);
  ctx.lineTo(-8, 14);
  ctx.lineTo(-22, 14);
  ctx.lineTo(-8, 8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#eaffff";
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(4, 5);
  ctx.lineTo(0, 8);
  ctx.lineTo(-4, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawPlayer() {
  if (!engine.player.active) return;
  const p = engine.player;
  if (p.invincible > 0 && Math.floor(p.invincible * 12) % 2 === 0) return;
  const playerFrame = p.dual ? 7 : p.invincible > 0 ? 5 : 0;
  const rendered = drawSprite(spriteSheets.player, playerFrame % 4, Math.floor(playerFrame / 4), p.x, p.y, p.dual ? 64 : 58);
  if (!rendered) drawShip(p.x, p.y, 0.9, p.captured ? "#ffc857" : "#55e6ff");
  if (p.dual && !rendered) {
    drawShip(p.x - 18, p.y + 5, 0.55, "#8cf3ff");
    drawShip(p.x + 18, p.y + 5, 0.55, "#8cf3ff");
  }
  if (engine.state === GAME_STATES.RESPAWNING) text("RE-ENTRY", p.x, p.y + 33, 10, "#b6f1ff", "center", 800);
}

function drawEnemy(enemy) {
  if (!enemy.alive) return;
  ctx.save();
  ctx.translate(enemy.x, enemy.y);
  const hitColor = enemy.hitFlash > 0 ? "#ffffff" : enemy.color;
  const scale = enemy.isBoss ? 1.12 : 1;
  ctx.scale(scale, scale);
  ctx.shadowColor = hitColor;
  ctx.shadowBlur = enemy.isBoss ? 24 : 11;
  if (!enemy.isBoss) {
    const frame = { swarm: [0, 0], diver: [1, 0], guardian: [2, 0], commander: [3, 0] }[enemy.type] ?? [0, 0];
    const rendered = drawSprite(spriteSheets.enemies, frame[0], enemy.state === "diving" ? 1 : frame[1], 0, 0, 64);
    if (rendered) {
      ctx.restore();
      if (enemy.state === "warning") {
        const pulse = 1 + Math.sin(engine.stateTime * 22) * 0.12;
        ctx.save();
        ctx.strokeStyle = "#ffc857";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, (enemy.radius + 10) * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        text("!", enemy.x, enemy.y - enemy.radius - 18, 18, "#ffc857", "center", 900);
        ctx.restore();
      }
      if (debug) text(enemy.label, enemy.x, enemy.y + enemy.radius + 13, 8, enemy.color, "center", 700);
      return;
    }
  }
  ctx.fillStyle = hitColor;
  ctx.strokeStyle = "rgba(2, 5, 18, 0.8)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  if (enemy.isBoss) {
    ctx.moveTo(0, -44);
    ctx.lineTo(23, -27);
    ctx.lineTo(45, -9);
    ctx.lineTo(31, 25);
    ctx.lineTo(13, 35);
    ctx.lineTo(0, 25);
    ctx.lineTo(-13, 35);
    ctx.lineTo(-31, 25);
    ctx.lineTo(-45, -9);
    ctx.lineTo(-23, -27);
  } else if (enemy.type === "swarm") {
    ctx.moveTo(0, -14);
    ctx.lineTo(14, -3);
    ctx.lineTo(8, 13);
    ctx.lineTo(0, 8);
    ctx.lineTo(-8, 13);
    ctx.lineTo(-14, -3);
  } else if (enemy.type === "diver") {
    ctx.moveTo(0, -17);
    ctx.lineTo(17, 10);
    ctx.lineTo(5, 8);
    ctx.lineTo(0, 16);
    ctx.lineTo(-5, 8);
    ctx.lineTo(-17, 10);
  } else if (enemy.type === "guardian") {
    roundedRect(ctx, -16, -14, 32, 28, 6);
  } else {
    ctx.moveTo(0, -19);
    ctx.lineTo(17, -8);
    ctx.lineTo(14, 10);
    ctx.lineTo(5, 17);
    ctx.lineTo(0, 11);
    ctx.lineTo(-5, 17);
    ctx.lineTo(-14, 10);
    ctx.lineTo(-17, -8);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#071226";
  ctx.beginPath();
  ctx.arc(0, enemy.isBoss ? -2 : 0, enemy.isBoss ? 16 : 5, 0, Math.PI * 2);
  ctx.fill();
  if (enemy.isBoss) {
    ctx.strokeStyle = enemy.coreExposed ? "#ffc857" : "#6a7893";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, -2, 15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = enemy.coreExposed ? "#ffc857" : "#6a7893";
    ctx.beginPath();
    ctx.arc(0, -2, 7, 0, Math.PI * 2);
    ctx.fill();
    const barWidth = 98;
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.fillRect(-barWidth / 2, -65, barWidth, 5);
    ctx.fillStyle = "#ff5c8a";
    ctx.fillRect(-barWidth / 2, -65, barWidth * (enemy.hp / enemy.maxHp), 5);
    text(`CORE · PHASE ${enemy.bossPhase}`, 0, -79, 10, "#ffc857", "center", 800);
  }
  ctx.restore();
  if (enemy.state === "warning") {
    const pulse = 1 + Math.sin(engine.stateTime * 22) * 0.12;
    ctx.save();
    ctx.strokeStyle = "#ffc857";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, (enemy.radius + 10) * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    text("!", enemy.x, enemy.y - enemy.radius - 18, 18, "#ffc857", "center", 900);
    ctx.restore();
  }
  if (debug && !enemy.isBoss) text(enemy.label, enemy.x, enemy.y + enemy.radius + 13, 8, enemy.color, "center", 700);
}

function drawCapturedShip() {
  if (!engine.capturedShip) return;
  const commander = engine.enemies.find((enemy) => enemy.id === engine.capturedShip.commanderId);
  if (!commander?.alive) return;
  drawShip(commander.x, commander.y + 27, 0.55, "#ffc857");
  text("CAPTURED", commander.x, commander.y + 48, 9, "#ffc857", "center", 800);
}

function drawBullets() {
  for (const bullet of engine.playerBullets) {
    ctx.save();
    ctx.shadowColor = "#a9fbff";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "#eaffff";
    ctx.fillRect(bullet.x - 2, bullet.y - 8, 4, 16);
    ctx.restore();
  }
  for (const bullet of engine.enemyBullets) {
    ctx.save();
    ctx.shadowColor = "#ff5c8a";
    ctx.shadowBlur = 9;
    ctx.fillStyle = "#ffb1c8";
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawParticles() {
  for (const particle of engine.particles) {
    ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
    ctx.fillStyle = particle.color;
    ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
  }
  ctx.globalAlpha = 1;
}

function drawWorld() {
  for (const enemy of engine.enemies) drawEnemy(enemy);
  drawCapturedShip();
  drawBullets();
  drawPlayer();
  drawParticles();
}

function drawPanel(titleValue, subtitle, color = "#55e6ff") {
  ctx.fillStyle = "rgba(2, 5, 18, 0.84)";
  roundedRect(ctx, 185, 135, WIDTH - 370, 270, 20);
  ctx.fill();
  ctx.strokeStyle = `${color}88`;
  ctx.lineWidth = 2;
  ctx.stroke();
  outlinedText(titleValue, WIDTH / 2, 194, 38, color);
  if (subtitle) text(subtitle, WIDTH / 2, 235, 15, "#b9d7e6", "center", 500);
}

function drawTitle() {
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = "#55e6ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(WIDTH / 2, 180, 110, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  drawShip(WIDTH / 2, 180, 1.8, "#55e6ff");
  ctx.restore();
  outlinedText("GALAXY", WIDTH / 2, 276, 54, "#eaffff");
  outlinedText("SWARM", WIDTH / 2, 332, 54, "#c77dff");
  text("A NEW ARCADE DEFENSE LOOP", WIDTH / 2, 365, 12, "#8faec5", "center", 700);
  text("PRESS ENTER TO START", WIDTH / 2, 424 + Math.sin(performance.now() / 240) * 3, 20, "#ffc857", "center", 800);
  text("←/A MOVE   ·   →/D MOVE   ·   SPACE/Z FIRE   ·   P PAUSE", WIDTH / 2, 463, 11, "#b9d7e6", "center", 500);
  text(`HIGH SCORE  ${String(engine.highScore).padStart(7, "0")}`, WIDTH / 2, 495, 14, "#c77dff", "center", 800);
}

function drawReady() {
  drawPanel(engine.readyLabel === "BONUS" ? "BONUS WAVE" : `WAVE ${engine.readyLabel}`, "FORMATION LOCKING · PREPARE YOUR SHIP", engine.readyLabel === "BONUS" ? "#ffc857" : "#55e6ff");
  outlinedText(String(Math.max(1, Math.ceil(engine.readyTimer))), WIDTH / 2, 315, 70, "#eaffff");
  text("GET READY", WIDTH / 2, 365, 12, "#8faec5", "center", 800);
}

function drawWaveClear() {
  drawPanel(engine.waveResolution === "bonus" ? "BONUS COMPLETE" : "WAVE CLEAR", engine.waveResolution === "bonus" ? "BONUS SCORE BANKED" : `WAVE ${engine.wave} REWARD  +${engine.wave * 500}`, engine.waveResolution === "bonus" ? "#ffc857" : "#55e6ff");
  outlinedText(`NEXT: ${engine.nextWave <= 10 ? `WAVE ${engine.nextWave}` : "LOOP COMPLETE"}`, WIDTH / 2, 315, 27, "#eaffff");
  text("FORMATION RESETTING", WIDTH / 2, 365, 12, "#8faec5", "center", 800);
}

function drawPause() {
  ctx.fillStyle = "rgba(1, 3, 12, 0.72)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  if (engine.settingsOpen) {
    drawPanel("SETTINGS", "ARROW KEYS ADJUST · ENTER CLOSES", "#c77dff");
    const values = [
      ["MUSIC VOLUME", `${Math.round(engine.settings.musicVolume * 100)}%`],
      ["SFX VOLUME", `${Math.round(engine.settings.sfxVolume * 100)}%`],
      ["SCREEN SHAKE", engine.settings.screenShake ? "ON" : "OFF"],
      ["FLASH EFFECTS", engine.settings.flashEffects ? "ON" : "OFF"]
    ];
    values.forEach(([label, value], index) => {
      const y = 270 + index * 30;
      const selected = index === engine.settingsIndex;
      text(`${selected ? "▸" : " "} ${label}`, 315, y, 14, selected ? "#ffc857" : "#b9d7e6", "left", selected ? 800 : 500);
      text(value, 645, y, 14, selected ? "#ffc857" : "#d9f5ff", "right", 800);
    });
  } else {
    drawPanel("PAUSED", "SIMULATION HALTED · CHOOSE AN OPTION", "#55e6ff");
    const items = ["CONTINUE", "SETTINGS", "TITLE SCREEN"];
    items.forEach((item, index) => {
      const selected = index === engine.pauseMenuIndex;
      text(`${selected ? "▸" : "·"} ${item}`, WIDTH / 2, 275 + index * 34, 18, selected ? "#ffc857" : "#b9d7e6", "center", selected ? 800 : 500);
    });
  }
}

function drawGameOver() {
  drawPanel("GAME OVER", `FINAL SCORE  ${String(engine.score).padStart(7, "0")}`, "#ff5c8a");
  if (engine.newHighScore) outlinedText("NEW HIGH SCORE", WIDTH / 2, 270, 21, "#ffc857");
  else text(`HIGH SCORE  ${String(engine.highScore).padStart(7, "0")}`, WIDTH / 2, 270, 16, "#c77dff", "center", 800);
  const items = ["RESTART", "TITLE SCREEN"];
  items.forEach((item, index) => {
    const selected = (engine.gameOverMenuIndex ?? 0) === index;
    text(`${selected ? "▸" : "·"} ${item}`, WIDTH / 2, 325 + index * 34, 18, selected ? "#ffc857" : "#b9d7e6", "center", selected ? 800 : 500);
  });
}

function drawLoopComplete() {
  drawPanel("LOOP COMPLETE", "THE SWARM HAS BEEN BROKEN", "#ffc857");
  outlinedText("10,000 CORE BONUS", WIDTH / 2, 280, 22, "#eaffff");
  text(`FINAL SCORE  ${String(engine.score).padStart(7, "0")}`, WIDTH / 2, 322, 16, "#c77dff", "center", 800);
  text("ENTER · NEW RUN", WIDTH / 2, 370, 16, "#ffc857", "center", 800);
  text("ESC · TITLE SCREEN", WIDTH / 2, 400, 12, "#b9d7e6", "center", 500);
}

function drawDebug() {
  if (!debug) return;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(10, 64, 180, 72);
  text(`FPS target: 60`, 18, 78, 10, "#9cf4ff");
  text(`entities: ${engine.enemies.length}`, 18, 94, 10, "#9cf4ff");
  text(`bullets: ${engine.playerBullets.length + engine.enemyBullets.length}`, 18, 110, 10, "#9cf4ff");
  text(`pool active: ${engine.bulletPool.activeCount}`, 18, 126, 10, "#9cf4ff");
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.strokeRect(engine.player.x - engine.player.hitRadius, engine.player.y - engine.player.hitRadius, engine.player.hitRadius * 2, engine.player.hitRadius * 2);
}

function render(now) {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.save();
  if (engine.settings.screenShake && engine.shakeTimer > 0) {
    const amount = 4 * (engine.shakeTimer / 0.25);
    ctx.translate(Math.sin(now * 0.12) * amount, Math.cos(now * 0.16) * amount);
  }
  drawBackground(now);
  if (engine.state !== GAME_STATES.TITLE) {
    drawWorld();
    drawHud();
  }
  if (engine.state === GAME_STATES.TITLE) drawTitle();
  else if (engine.state === GAME_STATES.READY) drawReady();
  else if (engine.state === GAME_STATES.WAVE_CLEAR) drawWaveClear();
  else if (engine.state === GAME_STATES.PAUSED) drawPause();
  else if (engine.state === GAME_STATES.GAME_OVER) drawGameOver();
  else if (engine.state === GAME_STATES.LOOP_COMPLETE) drawLoopComplete();
  drawDebug();
  ctx.restore();
}

let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  engine.update(dt, input.snapshot());
  liveStatus.textContent = engine.getStatusText();
  render(now);
  window.requestAnimationFrame(frame);
}

window.__GALAXY_SWARM__ = {
  engine,
  input,
  canvas,
  render,
  getSnapshot: () => engine.getSnapshot()
};

canvas.focus({ preventScroll: true });
window.requestAnimationFrame(frame);
