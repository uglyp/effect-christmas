import * as THREE from 'three';

export type TreeMode = 'CHAOS' | 'FORMED';

export const CONFIG = {
  tree: { height: 12.2, radius: 4.7 },
  foliage: 32000,
  baubles: 64,
  lights: 210,
  sparks: 520,
  snow: 520,
  garlandTurns: 6.5,
  colors: {
    night: '#07140f',
    pineShade: '#123f28',
    pine: '#2f7d4a',
    gold: '#e4c27a',
    goldDeep: '#8a6233',
    candle: '#ffe3bc',
    cranberry: '#9e2b32',
    ivory: '#f3ebdd',
    snow: '#e7eef2',
    wood: '#3c2618',
    ink: '#24180d',
  },
};

export function helixPoint(t: number, turns = CONFIG.garlandTurns, phase = 0.35) {
  const { height, radius } = CONFIG.tree;
  const y = t * height - height / 2;
  const radial = radius * (1 - t) * 0.93 + 0.08;
  const theta = t * turns * Math.PI * 2 + phase;
  return new THREE.Vector3(Math.cos(theta) * radial, y, Math.sin(theta) * radial);
}

export function hashUnit(index: number, salt = 1) {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
}
