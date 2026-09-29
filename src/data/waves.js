/**
 * Wave configuration is intentionally kept out of the simulation code. A
 * designer can change composition, spacing, attack timing, or theme here
 * without changing WaveManager/Engine logic.
 */
export const WAVE_DATA = [
  {
    number: 1,
    theme: "dawn",
    attackDelay: [2.5, 2.5],
    speed: 32,
    composition: ["swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm"]
  },
  {
    number: 2,
    theme: "violet",
    attackDelay: [2.2, 2.5],
    speed: 35,
    composition: ["swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "diver", "diver", "diver", "diver", "swarm", "swarm", "swarm", "swarm"]
  },
  {
    number: 3,
    theme: "violet",
    attackDelay: [1.9, 2.3],
    speed: 38,
    composition: ["swarm", "swarm", "swarm", "swarm", "diver", "diver", "diver", "diver", "diver", "diver", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm"]
  },
  {
    number: 4,
    theme: "amber",
    attackDelay: [1.8, 2.2],
    speed: 41,
    composition: ["swarm", "swarm", "swarm", "swarm", "guardian", "guardian", "guardian", "guardian", "diver", "diver", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm"]
  },
  {
    number: 5,
    theme: "amber",
    attackDelay: [1.6, 2.0],
    speed: 44,
    composition: ["swarm", "swarm", "swarm", "swarm", "diver", "diver", "diver", "diver", "guardian", "guardian", "guardian", "guardian", "commander", "swarm", "swarm", "swarm", "swarm", "swarm"]
  },
  {
    number: 6,
    theme: "crimson",
    attackDelay: [1.4, 1.8],
    speed: 47,
    composition: ["swarm", "swarm", "swarm", "diver", "diver", "diver", "diver", "guardian", "guardian", "guardian", "guardian", "commander", "commander", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm"]
  },
  {
    number: 7,
    theme: "crimson",
    attackDelay: [1.2, 1.7],
    speed: 50,
    composition: ["swarm", "swarm", "diver", "diver", "diver", "diver", "guardian", "guardian", "guardian", "guardian", "commander", "commander", "commander", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm"]
  },
  {
    number: 8,
    theme: "cyan",
    attackDelay: [1.1, 1.5],
    speed: 53,
    composition: ["swarm", "diver", "diver", "diver", "diver", "guardian", "guardian", "guardian", "guardian", "commander", "commander", "commander", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm"]
  },
  {
    number: 9,
    theme: "cyan",
    attackDelay: [1.0, 1.4],
    speed: 57,
    composition: ["swarm", "diver", "diver", "diver", "diver", "guardian", "guardian", "guardian", "guardian", "commander", "commander", "commander", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm", "swarm"]
  },
  {
    number: 10,
    theme: "boss",
    attackDelay: [1.0, 1.2],
    speed: 30,
    boss: true,
    composition: ["commander", "guardian", "guardian", "guardian", "guardian", "commander", "guardian", "guardian"]
  }
];

export const BONUS_WAVE_DATA = {
  number: 5,
  theme: "bonus",
  duration: 30,
  attackDelay: [999, 999],
  speed: 62,
  noAttack: true,
  composition: ["swarm", "swarm", "swarm", "swarm", "diver", "diver", "diver", "diver", "swarm", "swarm", "swarm", "swarm", "diver", "diver", "swarm", "swarm", "swarm", "swarm"]
};

export function getWaveData(number) {
  return WAVE_DATA[number - 1] ?? WAVE_DATA[0];
}
