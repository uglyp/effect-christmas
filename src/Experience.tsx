import { Suspense, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { extend as extendFiber, useFrame, useThree } from '@react-three/fiber';
import { Environment, OrbitControls, Stars, shaderMaterial } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { MathUtils, ShaderMaterial, type Group, type Mesh, type Points } from 'three';
import * as THREE from 'three';
import { CONFIG, hashUnit, helixPoint, type TreeMode } from './treeConfig';

declare module '@react-three/fiber' {
  interface ThreeElements {
    foliageMaterial: any;
  }
}

type FoliageMat = ShaderMaterial & { uTime: number; uProgress: number };

interface Motion {
  spin: number;
  tilt: number;
}

interface ExperienceProps {
  mode: TreeMode;
  snow: boolean;
  reducedMotion: boolean;
  controlsEnabled: boolean;
  autoRotate: boolean;
  motion: MutableRefObject<Motion>;
}

const foliageShader = {
  uniforms: { uTime: 0, uProgress: 0 },
  vertex: `
    uniform float uTime;
    uniform float uProgress;
    attribute vec3 aTargetPos;
    attribute float aRandom;
    attribute float aShell;
    varying float vRandom;
    varying float vMix;
    varying float vHeight;
    varying float vShell;
    varying float vRadius;
    float cubicInOut(float t) {
      return t < 0.5 ? 4.0 * t * t * t : 0.5 * pow(2.0 * t - 2.0, 3.0) + 1.0;
    }
    void main() {
      vRandom = aRandom;
      vShell = aShell;
      vHeight = aTargetPos.y;
      vRadius = length(position.xz);
      float t = cubicInOut(clamp(uProgress, 0.0, 1.0));
      float yNorm = clamp((aTargetPos.y + 6.1) / 12.2, 0.0, 1.0);
      float delay = yNorm * 0.46;
      float localT = smoothstep(delay, min(delay + 0.5, 1.0), t);
      vMix = localT;
      float sway = sin(uTime * 1.15 + aTargetPos.y * 0.85 + aRandom * 6.2831) * (0.02 + aShell * 0.07) * localT;
      vec3 formed = aTargetPos;
      formed.x += sway;
      formed.z += cos(uTime * 0.9 + aRandom * 7.0) * (0.02 + aShell * 0.06) * localT;
      float openT = 1.0 - localT;
      vec3 chaos = position;
      float formedAng = atan(formed.z, formed.x);
      float chaosAng = atan(chaos.z, chaos.x);
      float delta = atan(sin(chaosAng - formedAng), cos(chaosAng - formedAng));
      float ang = formedAng + openT * (delta + 6.28318 * 0.5);
      ang += uTime * 0.05 * openT * (aRandom > 0.5 ? 1.0 : -1.0);
      float rad = mix(length(chaos.xz), length(formed.xz), localT);
      float y = mix(chaos.y, formed.y, localT);
      y += sin(uTime * 0.45 + aRandom * 6.28318) * 0.16 * openT;
      vec3 finalPos = vec3(cos(ang) * rad, y, sin(ang) * rad);
      vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
      float travel = sin(localT * 3.14159);
      float rank = fract(aRandom * 17.13);
      float bright = pow(rank, 1.65);
      float formedMul = 0.42 + aRandom * 0.5 + aShell * 0.28;
      float chaosMul = mix(0.72, 1.55, bright);
      float mul = mix(chaosMul, formedMul, localT);
      float px = mix(mix(220.0, 480.0, bright), 280.0, localT);
      float cap = mix(mix(4.1, 10.4, bright), 8.2, localT) + travel * 1.2;
      gl_PointSize = clamp((px * mul) / max(1.0, -mvPosition.z), 1.8, cap);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragment: `
    uniform float uTime;
    varying float vRandom;
    varying float vMix;
    varying float vHeight;
    varying float vShell;
    varying float vRadius;
    void main() {
      float dist = distance(gl_PointCoord, vec2(0.5));
      if (dist > 0.5) discard;
      float glow = pow(1.0 - smoothstep(0.0, 0.5, dist), 1.55);
      float twinkle = pow(0.5 + 0.5 * sin(uTime * (1.1 + vRandom * 5.5) + vRandom * 40.0), 2.4);
      float tipLight = smoothstep(0.5, 1.0, vShell);
      vec3 core = vec3(0.015, 0.11, 0.045);
      vec3 mid = vec3(0.04, 0.32, 0.12);
      vec3 tip = vec3(0.08, 0.48, 0.18);
      vec3 gold = vec3(1.05, 0.62, 0.16);
      vec3 berry = vec3(0.82, 0.08, 0.1);
      vec3 ivory = vec3(1.0, 0.84, 0.58);
      vec3 ice = vec3(0.42, 0.72, 0.78);
      float pick = fract(vRandom * 7.13);
      vec3 lamp = mix(gold, berry, step(0.4, pick));
      lamp = mix(lamp, ivory, step(0.7, pick));
      lamp = mix(lamp, ice, step(0.9, pick));
      float jewel = step(0.7, vRandom) * tipLight;
      vec3 pine = mix(core, mid, smoothstep(0.0, 0.55, vShell));
      pine = mix(pine, tip, smoothstep(0.45, 1.0, vShell));
      pine = mix(pine, lamp, jewel);
      pine *= mix(0.85, 0.55 + 0.45 * twinkle, jewel + tipLight * 0.25);
      float yNorm = clamp((vHeight + 6.1) / 12.2, 0.0, 1.0);
      float sweep = fract(uTime * 0.16);
      float along = min(abs(yNorm - sweep), 1.0 - abs(yNorm - sweep));
      float band = exp(-along * along * 80.0);
      float crownFade = smoothstep(0.97, 0.62, yNorm);
      pine += vec3(0.7, 0.38, 0.08) * band * tipLight * crownFade * 0.42;
      float travel = sin(clamp(vMix, 0.0, 1.0) * 3.14159);
      pine += lamp * travel * jewel * 0.65;
      float rank = fract(vRandom * 17.13);
      float lift = pow(rank, 0.82);
      vec3 chaos = mix(lamp * 0.32 + vec3(0.04, 0.1, 0.04), lamp * 0.82, smoothstep(0.04, 0.36, rank));
      chaos = mix(chaos, lamp * 1.45, smoothstep(0.38, 0.7, rank));
      chaos = mix(chaos, mix(lamp, vec3(1.0, 0.97, 0.88), 0.62) * 2.05, smoothstep(0.82, 1.0, rank));
      chaos *= mix(0.78, 0.36 + 0.82 * twinkle, smoothstep(0.16, 0.78, rank));
      vec3 color = mix(chaos, pine, vMix);
      float chaosAlpha = glow * mix(0.42, 1.0, lift);
      float formedAlpha = glow * (0.55 + 0.45 * vShell);
      float alpha = mix(chaosAlpha, formedAlpha, vMix);
      gl_FragColor = vec4(color * alpha, alpha);
    }
  `,
};

function cubicInOut(value: number) {
  const t = MathUtils.clamp(value, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 0.5 * (2 * t - 2) ** 3 + 1;
}

function smooth01(edge0: number, edge1: number, value: number) {
  const t = MathUtils.clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function scatterVolume(index: number, seed: number, radius: number, height: number) {
  const theta = hashUnit(index, seed) * Math.PI * 2;
  const reach = Math.sqrt(hashUnit(index, seed + 1));
  const y = (hashUnit(index, seed + 2) - 0.42) * height;
  return new THREE.Vector3(
    Math.cos(theta) * radius * reach,
    MathUtils.clamp(y, -2.5, 5.5),
    Math.sin(theta) * radius * reach,
  );
}

const FoliageShader = shaderMaterial(foliageShader.uniforms, foliageShader.vertex, foliageShader.fragment);
extendFiber({ FoliageMaterial: FoliageShader });

function treeTarget(index: number) {
  const { height, radius } = CONFIG.tree;
  const tiers = 7;
  const yNorm = 0.03 + 0.94 * Math.pow(hashUnit(index, 4), 0.82);
  const tier = Math.min(tiers - 1, Math.floor(yNorm * tiers));
  const within = yNorm * tiers - tier;
  const scallop = 0.78 + 0.22 * Math.sin(within * Math.PI);
  const profile = radius * Math.pow(1 - yNorm, 0.8) * scallop;
  const tip = hashUnit(index, 6) > 0.38;
  const shell = tip
    ? 0.64 + Math.pow(hashUnit(index, 8), 0.65) * 0.36
    : Math.pow(hashUnit(index, 8), 0.8) * 0.64;
  const reach = tip ? 0.82 + (shell - 0.64) * 0.7 : 0.1 + shell * 0.95;
  const branches = 10;
  const branch = Math.floor(hashUnit(index, 9) * branches);
  const flare = 0.9 + hashUnit(branch + tier * 13, 12) * 0.16;
  const radial = profile * flare * reach;
  const branchTheta = (branch / branches) * Math.PI * 2 + tier * 0.45;
  const angle = branchTheta + (hashUnit(index, 10) - 0.5) * 1.15;
  const droop = (tip ? 0.18 + 0.42 * (1 - yNorm) : 0.04) * shell * shell;
  const y = Math.max(yNorm * height - height / 2 - droop, -height / 2 + 0.28);
  return [Math.cos(angle) * radial, y, Math.sin(angle) * radial, shell] as const;
}

function TreeBody({ mode, reducedMotion }: { mode: TreeMode; reducedMotion: boolean }) {
  const ref = useRef<Mesh>(null);
  const materialRef = useRef<ShaderMaterial>(null);
  const height = CONFIG.tree.height * 0.82;
  useFrame((state, delta) => {
    const mesh = ref.current;
    if (!mesh) return;
    const target = mode === 'FORMED' ? 1 : 0.001;
    const next = reducedMotion ? target : MathUtils.damp(mesh.scale.x, target, 1.55, delta);
    mesh.scale.setScalar(Math.max(next, 0.001));
    if (materialRef.current) materialRef.current.uniforms.uTime.value = reducedMotion ? 0 : state.clock.elapsedTime;
  });

  return (
    <mesh ref={ref} position={[0, 0.55, 0]} scale={0.001}>
      <coneGeometry args={[CONFIG.tree.radius * 0.56, height, 56]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={{ uTime: { value: 0 } }}
        vertexShader={`
          varying vec3 vLocal;
          void main() {
            vLocal = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        transparent
        depthWrite={false}
        fragmentShader={`
          uniform float uTime;
          varying vec3 vLocal;
          void main() {
            float angle = atan(vLocal.z, vLocal.x);
            float filament = sin(vLocal.y * 8.5 - uTime * 2.6 + angle * 5.0);
            float line = smoothstep(0.78, 0.98, filament);
            float warm = smoothstep(0.9, 1.0, sin(vLocal.y * 4.2 + uTime * 1.5 - angle * 2.0));
            vec3 pine = vec3(0.004, 0.03, 0.014);
            vec3 color = pine;
            color += vec3(0.1, 0.46, 0.2) * line;
            color += vec3(1.0, 0.55, 0.16) * warm * 0.35;
            float alpha = 0.62 * smoothstep(2.35, 0.25, length(vLocal.xz));
            gl_FragColor = vec4(color, alpha);
          }
        `}
      />
    </mesh>
  );
}

function Foliage({ mode, reducedMotion }: { mode: TreeMode; reducedMotion: boolean }) {
  const materialRef = useRef<FoliageMat>(null);
  const buffers = useMemo(() => {
    const count = CONFIG.foliage;
    const positions = new Float32Array(count * 3);
    const targets = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    const shells = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const [x, y, z, shell] = treeTarget(index);
      targets[index * 3] = x;
      targets[index * 3 + 1] = y;
      targets[index * 3 + 2] = z;
      randoms[index] = hashUnit(index, 8);
      shells[index] = shell;
      const theta = hashUnit(index, 11) * Math.PI * 2;
      const unit = hashUnit(index, 12);
      const inner = hashUnit(index, 14) > 0.28;
      const rad = inner
        ? 0.3 + Math.pow(unit, 0.8) * 5.2
        : 1.6 + Math.pow(unit, 0.48) * 6.5;
      const ySpan = inner ? 9.4 : 12.8;
      positions[index * 3] = Math.cos(theta) * rad;
      positions[index * 3 + 1] = MathUtils.clamp((hashUnit(index, 13) - 0.44) * ySpan, -2.4, 5.4);
      positions[index * 3 + 2] = Math.sin(theta) * rad;
    }
    return { positions, targets, randoms, shells };
  }, []);

  useFrame((state, delta) => {
    const material = materialRef.current;
    if (!material) return;
    material.uTime = reducedMotion ? 0 : state.clock.elapsedTime;
    const target = mode === 'FORMED' ? 1 : 0;
    material.uProgress = reducedMotion ? target : MathUtils.damp(material.uProgress, target, 1.15, delta);
  });

  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[buffers.positions, 3]} />
        <bufferAttribute attach="attributes-aTargetPos" args={[buffers.targets, 3]} />
        <bufferAttribute attach="attributes-aRandom" args={[buffers.randoms, 1]} />
        <bufferAttribute attach="attributes-aShell" args={[buffers.shells, 1]} />
      </bufferGeometry>
      <foliageMaterial ref={materialRef} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

function useSnowTexture() {
  return useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const gradient = context.createRadialGradient(256, 256, 20, 256, 256, 250);
    gradient.addColorStop(0, 'rgba(236, 242, 244, 0.5)');
    gradient.addColorStop(0.38, 'rgba(220, 230, 232, 0.14)');
    gradient.addColorStop(1, 'rgba(220, 230, 232, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 512, 512);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);
}

function Room({ reducedMotion }: { reducedMotion: boolean }) {
  const snow = useSnowTexture();
  const skyRef = useRef<ShaderMaterial>(null);
  const ground = -CONFIG.tree.height / 2;
  useFrame((state) => {
    if (skyRef.current) skyRef.current.uniforms.uTime.value = reducedMotion ? 0 : state.clock.elapsedTime;
  });
  return (
    <>
      <mesh frustumCulled={false} renderOrder={-1}>
        <sphereGeometry args={[80, 48, 32]} />
        <shaderMaterial
          ref={skyRef}
          side={THREE.BackSide}
          depthWrite={false}
          uniforms={{ uTime: { value: 0 } }}
          vertexShader={`varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`}
          fragmentShader={`
            uniform float uTime;
            varying vec3 vPos;
            void main() {
              vec3 direction = normalize(vPos);
              float height = direction.y;
              vec3 color = mix(vec3(0.004, 0.01, 0.012), vec3(0.012, 0.03, 0.028), smoothstep(-0.4, 0.65, height));
              float curtain = sin(direction.x * 5.5 + uTime * 0.18) * sin(direction.z * 3.4 - uTime * 0.12 + direction.y);
              float veil = smoothstep(0.05, 0.42, height) * smoothstep(0.92, 0.38, height);
              color += vec3(0.015, 0.16, 0.09) * pow(max(curtain, 0.0), 2.0) * veil;
              color += vec3(0.22, 0.08, 0.02) * pow(max(-curtain, 0.0), 2.0) * veil * 0.55;
              float drift = sin(direction.x * 9.0 - uTime * 0.27 + direction.y * 4.0);
              color += vec3(0.04, 0.2, 0.16) * smoothstep(0.72, 1.0, drift) * veil * 0.45;
              float horizon = exp(-abs(height + 0.08) * 7.0);
              color += vec3(0.05, 0.1, 0.05) * horizon;
              gl_FragColor = vec4(color, 1.0);
            }
          `}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, ground + 0.02, 0]}>
        <circleGeometry args={[6.4, 64]} />
        {snow && <meshBasicMaterial map={snow} transparent depthWrite={false} />}
      </mesh>
      <mesh position={[0, ground + 0.95, 0]}>
        <cylinderGeometry args={[0.18, 0.38, 1.9, 14]} />
        <meshStandardMaterial color={CONFIG.colors.wood} roughness={0.86} metalness={0.04} />
      </mesh>
    </>
  );
}

const GIFT_LAYOUT = [
  { x: -1.05, z: 2.55, rot: 0.22, color: '#9e2b32', size: [0.72, 0.46, 0.56] },
  { x: -0.15, z: 2.95, rot: -0.12, color: '#e7dcc8', size: [0.48, 0.36, 0.48] },
  { x: 0.75, z: 2.65, rot: 0.18, color: '#1e5a3a', size: [0.6, 0.42, 0.5] },
  { x: 1.45, z: 2.25, rot: -0.16, color: '#8d3034', size: [0.42, 0.5, 0.42] },
] as const;

function Gifts() {
  const ribbon = useMemo(() => new THREE.MeshStandardMaterial({
    color: CONFIG.colors.gold,
    roughness: 0.34,
    metalness: 0.62,
  }), []);
  const ground = -CONFIG.tree.height / 2;

  return (
    <group>
      {GIFT_LAYOUT.map((gift) => {
        const [width, height, depth] = gift.size;
        return (
          <group key={`${gift.x}-${gift.z}`} position={[gift.x, ground + height / 2 + 0.03, gift.z]} rotation={[0, gift.rot, 0]}>
            <mesh>
              <boxGeometry args={[width, height, depth]} />
              <meshStandardMaterial color={gift.color} roughness={0.74} metalness={0.04} />
            </mesh>
            <mesh position={[0, height / 2 + 0.012, 0]} material={ribbon}>
              <boxGeometry args={[width * 1.02, 0.024, depth * 0.12]} />
            </mesh>
            <mesh position={[0, height / 2 + 0.012, 0]} material={ribbon}>
              <boxGeometry args={[width * 0.12, 0.024, depth * 1.02]} />
            </mesh>
            <mesh position={[0, 0, depth / 2 + 0.012]} material={ribbon}>
              <boxGeometry args={[width * 0.1, height * 1.02, 0.02]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function Garland({ mode, reducedMotion }: { mode: TreeMode; reducedMotion: boolean }) {
  const groupRef = useRef<Group>(null);
  const progress = useRef(0);
  const pose = useMemo(() => new THREE.Vector3(), []);
  const cord = useMemo(() => {
    const points = Array.from({ length: 160 }, (_, index) => helixPoint(index / 159));
    const curve = new THREE.CatmullRomCurve3(points);
    return new THREE.TubeGeometry(curve, 320, 0.028, 5, false);
  }, []);
  const bulbs = useMemo(() => Array.from({ length: CONFIG.lights }, (_, index) => {
    const t = index / (CONFIG.lights - 1);
    const point = helixPoint(t);
    const length = Math.hypot(point.x, point.z) || 1;
    point.x += (point.x / length) * 0.08;
    point.z += (point.z / length) * 0.08;
    const jewels = ['#ffd27a', '#ff5d67', '#fff1cf', '#7ee0c8', '#ffb45a', '#ff4d6a'];
    const palette = jewels[index % jewels.length];
    const color = new THREE.Color(palette);
    const chaos = scatterVolume(index, 20, 7.4, 10.5);
    return {
      t,
      point,
      chaos,
      current: point.clone(),
      base: { r: color.r, g: color.g, b: color.b },
      scale: index % 9 === 0 ? 0.13 : 0.08,
      speed: 1.4 + hashUnit(index, 2) * 2.8,
      offset: hashUnit(index, 3) * Math.PI * 2,
    };
  }), []);

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const next = reducedMotion ? 1 : MathUtils.damp(group.scale.x, 1, 1.7, delta);
    group.scale.setScalar(Math.max(next, 0.001));
    const formed = mode === 'FORMED';
    const cord = group.children[0] as Mesh;
    const cordMaterial = cord.material as THREE.MeshStandardMaterial;
    const cordTarget = formed ? 1 : 0;
    cordMaterial.opacity = reducedMotion ? cordTarget : MathUtils.damp(cordMaterial.opacity, cordTarget, 2.4, delta);
    cordMaterial.emissiveIntensity = 0.85 * cordMaterial.opacity;
    const time = reducedMotion ? 0 : state.clock.elapsedTime;
    const goal = formed ? 1 : 0;
    progress.current = reducedMotion ? goal : MathUtils.damp(progress.current, goal, 1.15, delta);
    const shaped = cubicInOut(progress.current);
    const pulseA = (time * 0.23) % 1;
    const pulseB = (time * 0.16 + 0.47) % 1;
    const wrap = (a: number, b: number) => {
      const distance = Math.abs(a - b);
      return Math.min(distance, 1 - distance);
    };
    group.children.forEach((child, index) => {
      if (index === 0) return;
      const bulb = bulbs[index - 1];
      const mesh = child as Mesh;
      const material = mesh.material as THREE.MeshBasicMaterial;
      const head = formed
        ? Math.exp(-(wrap(bulb.t, pulseA) ** 2) * 140) + Math.exp(-(wrap(bulb.t, pulseB) ** 2) * 80) * 0.7
        : 0;
      const flicker = 0.55 + 0.22 * (0.5 + 0.5 * Math.sin(time * bulb.speed + bulb.offset));
      const crown = 1 - bulb.t * bulb.t * 0.7;
      const gain = flicker + head * 1.6 * crown;
      material.color.r = bulb.base.r * gain;
      material.color.g = bulb.base.g * gain;
      material.color.b = bulb.base.b * gain;
      mesh.scale.setScalar(bulb.scale * (1 + head * 0.9));
      const yNorm = MathUtils.clamp((bulb.point.y + 6.1) / 12.2, 0, 1);
      const delay = yNorm * 0.46;
      const local = smooth01(delay, Math.min(delay + 0.5, 1), shaped);
      pose.copy(bulb.chaos).lerp(bulb.point, local);
      mesh.position.copy(pose);
    });
  });

  return (
    <group ref={groupRef} scale={0.02}>
      <mesh geometry={cord}>
        <meshStandardMaterial color="#c9893a" emissive="#ffb45a" emissiveIntensity={0.85} roughness={0.32} metalness={0.55} toneMapped={false} transparent depthWrite={false} />
      </mesh>
      {bulbs.map((bulb, index) => (
        <mesh key={index} position={bulb.point} scale={bulb.scale}>
          <sphereGeometry args={[1, 12, 12]} />
          <meshBasicMaterial color="#fff1cf" toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

const BAUBLE_LOOKS = [
  { color: '#e4c27a', emissive: '#e4c27a', emissiveIntensity: 0.28, roughness: 0.2, metalness: 0.86 },
  { color: '#c4373c', emissive: '#ff5a4a', emissiveIntensity: 0.34, roughness: 0.24, metalness: 0.6 },
  { color: '#f4efe4', emissive: '#fff4df', emissiveIntensity: 0.16, roughness: 0.16, metalness: 0.74 },
  { color: '#1c6b42', emissive: '#39d27a', emissiveIntensity: 0.3, roughness: 0.22, metalness: 0.68 },
];

function Baubles({ mode, reducedMotion }: { mode: TreeMode; reducedMotion: boolean }) {
  const groupRef = useRef<Group>(null);
  const progress = useRef(0);
  const pose = useMemo(() => new THREE.Vector3(), []);
  const materials = useMemo(() => BAUBLE_LOOKS.map((look) => new THREE.MeshStandardMaterial(look)), []);
  const data = useMemo(() => Array.from({ length: CONFIG.baubles }, (_, index) => {
    const yNorm = 0.08 + 0.84 * (index / (CONFIG.baubles - 1));
    const y = yNorm * CONFIG.tree.height - CONFIG.tree.height / 2;
    const radial = CONFIG.tree.radius * (1 - yNorm) * (0.9 + hashUnit(index, 2) * 0.12);
    const theta = index * 2.399963 + 1.15;
    const target = new THREE.Vector3(Math.cos(theta) * radial, y, Math.sin(theta) * radial);
    const chaos = scatterVolume(index, 30, 8.4, 11);
    return {
      target,
      chaos,
      current: chaos.clone(),
      scale: 0.16 + hashUnit(index, 6) * 0.2,
      material: materials[index % materials.length],
      speed: 0.6 + hashUnit(index, 7),
      offset: hashUnit(index, 8) * 10,
    };
  }), [materials]);

  useLayoutEffect(() => {
    groupRef.current?.children.forEach((child, index) => {
      child.position.copy(data[index].chaos);
    });
  }, [data]);

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const formed = mode === 'FORMED';
    const goal = formed ? 1 : 0;
    progress.current = reducedMotion ? goal : MathUtils.damp(progress.current, goal, 1.15, delta);
    const shaped = cubicInOut(progress.current);
    const time = reducedMotion ? 0 : state.clock.elapsedTime;
    data.forEach((item, index) => {
      const mesh = group.children[index] as Mesh;
      if (!mesh) return;
      const yNorm = MathUtils.clamp((item.target.y + 6.1) / 12.2, 0, 1);
      const delay = yNorm * 0.46;
      const local = smooth01(delay, Math.min(delay + 0.5, 1), shaped);
      pose.copy(item.chaos).lerp(item.target, local);
      mesh.position.copy(pose);
      if (!reducedMotion) mesh.position.y += Math.sin(time * item.speed + item.offset) * (formed ? 0.045 : 0.14);
      mesh.rotation.y += delta * (reducedMotion ? 0 : formed ? 0.18 : 0.16);
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((item, index) => (
        <mesh key={index} scale={item.scale} material={item.material}>
          <sphereGeometry args={[1, 24, 24]} />
        </mesh>
      ))}
    </group>
  );
}

function Star({ mode, reducedMotion }: { mode: TreeMode; reducedMotion: boolean }) {
  const groupRef = useRef<Group>(null);
  const spin = useRef(0);
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    const outer = 0.86;
    const inner = 0.3;
    for (let index = 0; index < 10; index += 1) {
      const radius = index % 2 === 0 ? outer : inner;
      const angle = (index / 10) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (index === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    const star = new THREE.ExtrudeGeometry(shape, {
      depth: 0.12,
      bevelEnabled: true,
      bevelThickness: 0.035,
      bevelSize: 0.035,
      bevelSegments: 2,
    });
    star.center();
    return star;
  }, []);

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const formed = mode === 'FORMED';
    const target = formed ? 1 : 0.94;
    const next = reducedMotion ? target : MathUtils.damp(group.scale.x, target, 2.4, delta);
    group.scale.setScalar(Math.max(next, 0.001));
    const baseY = CONFIG.tree.height / 2 + 1.05;
    const lift = formed ? 0 : 0.9;
    const bob = reducedMotion ? 0 : Math.sin(state.clock.elapsedTime * (formed ? 0.8 : 0.9)) * (formed ? 0.04 : 0.16);
    group.position.y = baseY + lift + bob;
    if (!reducedMotion) spin.current += delta * (formed ? 0.22 : 0.5);
    group.lookAt(state.camera.position);
    group.rotateZ(spin.current);
  });

  const glow = useGlowTexture();

  return (
    <group ref={groupRef} position={[0, CONFIG.tree.height / 2 + 1.05, 0]} scale={0.001}>
      <mesh position={[0, 0, -0.15]}>
        <planeGeometry args={[2.15, 2.15]} />
        <meshBasicMaterial map={glow} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} opacity={0.72} />
      </mesh>
      <mesh geometry={geometry}>
        <meshStandardMaterial color="#f3d7a4" emissive="#c9843a" emissiveIntensity={0.28} roughness={0.32} metalness={0.55} />
      </mesh>
      <pointLight color="#ffd59a" intensity={4.2} distance={4.2} decay={2} position={[0, 0, 0.2]} />
    </group>
  );
}

function useGlowTexture() {
  return useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    if (!context) return texture;
    const gradient = context.createRadialGradient(128, 128, 4, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(255, 214, 140, 0.42)');
    gradient.addColorStop(0.3, 'rgba(255, 160, 54, 0.16)');
    gradient.addColorStop(0.62, 'rgba(255, 120, 30, 0.03)');
    gradient.addColorStop(1, 'rgba(255, 120, 30, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
    texture.needsUpdate = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);
}

function LightRise({ mode, reducedMotion }: { mode: TreeMode; reducedMotion: boolean }) {
  const ref = useRef<Points>(null);
  const groupRef = useRef<Group>(null);
  const speeds = useRef<Float32Array>(new Float32Array());
  const positions = useMemo(() => {
    const count = CONFIG.sparks;
    const array = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const speed = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const yNorm = hashUnit(index, 1);
      const y = yNorm * CONFIG.tree.height - CONFIG.tree.height / 2;
      const radius = CONFIG.tree.radius * (1 - yNorm) * (0.25 + hashUnit(index, 2) * 0.85);
      const theta = hashUnit(index, 3) * Math.PI * 2;
      array[index * 3] = Math.cos(theta) * radius;
      array[index * 3 + 1] = y;
      array[index * 3 + 2] = Math.sin(theta) * radius;
      const warm = hashUnit(index, 4) > 0.62;
      colors[index * 3] = warm ? 1 : 0.45;
      colors[index * 3 + 1] = warm ? 0.72 : 1;
      colors[index * 3 + 2] = warm ? 0.28 : 0.55;
      speed[index] = 0.55 + hashUnit(index, 5) * 1.35;
    }
    speeds.current = speed;
    return { array, colors };
  }, []);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (group) {
    const formed = mode === 'FORMED';
    const target = formed ? 1 : 0.35;
    const next = reducedMotion ? target : MathUtils.damp(group.scale.x || 0.2, target, 1.8, delta);
    group.scale.setScalar(Math.max(next, 0.001));
    group.visible = true;
    if (!reducedMotion) group.rotation.y += delta * (formed ? 0.04 : 0.12);
    }
    if (reducedMotion || !ref.current) return;
    const attribute = ref.current.geometry.attributes.position;
    const array = attribute.array as Float32Array;
    const speed = speeds.current;
    const top = CONFIG.tree.height / 2;
    const bottom = -top;
    for (let index = 0; index < speed.length; index += 1) {
      array[index * 3 + 1] += speed[index] * delta;
      if (array[index * 3 + 1] > top) array[index * 3 + 1] = bottom;
    }
    attribute.needsUpdate = true;
  });

  return (
    <group ref={groupRef}>
      <points ref={ref} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions.array, 3]} />
          <bufferAttribute attach="attributes-color" args={[positions.colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          vertexColors
          size={0.085}
          transparent
          opacity={0.95}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          sizeAttenuation
        />
      </points>
    </group>
  );
}

function useFlakeTexture() {
  return useMemo(() => {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    if (!context) return texture;
    const center = size / 2;
    const glow = context.createRadialGradient(center, center, 6, center, center, 120);
    glow.addColorStop(0, 'rgba(255,255,255,0.34)');
    glow.addColorStop(0.5, 'rgba(226,238,246,0.08)');
    glow.addColorStop(1, 'rgba(226,238,246,0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, size, size);
    context.translate(center, center);
    context.strokeStyle = 'rgba(255,255,255,0.98)';
    context.fillStyle = 'rgba(255,255,255,0.98)';
    context.lineCap = 'round';
    context.lineJoin = 'round';
    const arm = 108;
    for (let spoke = 0; spoke < 6; spoke += 1) {
      context.save();
      context.rotate((Math.PI * 2 * spoke) / 6);
      context.lineWidth = 9;
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(0, -arm);
      context.stroke();
      context.lineWidth = 6;
      for (const place of [0.4, 0.62, 0.82]) {
        const y = -arm * place;
        const spread = arm * (0.3 - place * 0.12);
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(spread, y - spread * 0.62);
        context.moveTo(0, y);
        context.lineTo(-spread, y - spread * 0.62);
        context.stroke();
      }
      context.beginPath();
      context.moveTo(0, -arm - 14);
      context.lineTo(12, -arm + 6);
      context.lineTo(0, -arm + 1);
      context.lineTo(-12, -arm + 6);
      context.closePath();
      context.fill();
      context.restore();
    }
    context.beginPath();
    context.arc(0, 0, 8, 0, Math.PI * 2);
    context.fill();
    texture.needsUpdate = true;
    return texture;
  }, []);
}

function Snowfall({ enabled, reducedMotion }: { enabled: boolean; reducedMotion: boolean }) {
  const ref = useRef<Points>(null);
  const materialRef = useRef<ShaderMaterial>(null);
  const speeds = useRef<Float32Array>(new Float32Array());
  const sway = useRef<Float32Array>(new Float32Array());
  const flake = useFlakeTexture();
  const viewport = useThree((state) => state.size);
  const buffers = useMemo(() => {
    const count = CONFIG.snow;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const spins = new Float32Array(count);
    const speed = new Float32Array(count);
    const drift = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const closer = hashUnit(index, 6) > 0.74;
      positions[index * 3] = (hashUnit(index, 1) - 0.5) * 26;
      positions[index * 3 + 1] = -8 + hashUnit(index, 3) * 20;
      positions[index * 3 + 2] = closer ? 1 + hashUnit(index, 2) * 6 : -10 + hashUnit(index, 2) * 9;
      sizes[index] = closer ? 1.75 + hashUnit(index, 7) * 0.5 : 1.15 + hashUnit(index, 7) * 0.4;
      spins[index] = hashUnit(index, 8) * Math.PI * 2;
      speed[index] = 0.32 + hashUnit(index, 4) * 0.55;
      drift[index] = (hashUnit(index, 5) - 0.5) * 0.45;
    }
    speeds.current = speed;
    sway.current = drift;
    return { positions, sizes, spins };
  }, []);

  useFrame((state, delta) => {
    const material = materialRef.current;
    const points = ref.current;
    if (material) {
      material.uniforms.uOpacity.value = enabled ? 1 : 0;
      material.uniforms.uTime.value = reducedMotion ? 0 : state.clock.elapsedTime;
      const narrow = viewport.width < 720;
      material.uniforms.uScale.value = narrow ? 230 : 320;
      material.uniforms.uMaxSize.value = narrow ? 22 : 28;
    }
    if (points) points.visible = enabled;
    if (!enabled || reducedMotion || !points) return;
    const attribute = points.geometry.attributes.position;
    const array = attribute.array as Float32Array;
    const speed = speeds.current;
    const drift = sway.current;
    const time = state.clock.elapsedTime;
    for (let index = 0; index < speed.length; index += 1) {
      array[index * 3] += Math.sin(time * 0.45 + index * 0.17) * drift[index] * delta;
      array[index * 3 + 1] -= speed[index] * delta;
      if (array[index * 3 + 1] < -8.4) {
        array[index * 3] = (hashUnit(index, 1) - 0.5) * 26;
        array[index * 3 + 1] = 11.2;
      }
    }
    attribute.needsUpdate = true;
  });

  return (
    <points ref={ref} frustumCulled={false} renderOrder={2}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[buffers.positions, 3]} />
        <bufferAttribute attach="attributes-aSize" args={[buffers.sizes, 1]} />
        <bufferAttribute attach="attributes-aSpin" args={[buffers.spins, 1]} />
      </bufferGeometry>
      <shaderMaterial
        ref={materialRef}
        transparent
        depthWrite={false}
        uniforms={{
          uMap: { value: flake },
          uOpacity: { value: 1 },
          uTime: { value: 0 },
          uScale: { value: 320 },
          uMaxSize: { value: 28 },
        }}
        vertexShader={`
          uniform float uTime;
          uniform float uScale;
          uniform float uMaxSize;
          attribute float aSize;
          attribute float aSpin;
          varying float vSpin;
          void main() {
            vSpin = aSpin + uTime * 0.25;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = clamp(aSize * uScale / max(1.0, -mvPosition.z), 10.0, uMaxSize);
            gl_Position = projectionMatrix * mvPosition;
          }
        `}
        fragmentShader={`
          uniform sampler2D uMap;
          uniform float uOpacity;
          varying float vSpin;
          void main() {
            if (uOpacity < 0.01) discard;
            vec2 centered = gl_PointCoord - 0.5;
            float c = cos(vSpin);
            float s = sin(vSpin);
            vec2 uv = mat2(c, -s, s, c) * centered + 0.5;
            vec4 flake = texture2D(uMap, uv);
            float alpha = flake.a * uOpacity;
            if (alpha < 0.05) discard;
            gl_FragColor = vec4(flake.rgb * alpha, alpha);
          }
        `}
      />
    </points>
  );
}

export default function Experience({
  mode,
  snow,
  reducedMotion,
  controlsEnabled,
  autoRotate,
  motion,
}: ExperienceProps) {
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const fitted = useRef('');
  const size = useThree((state) => state.size);
  const camera = useThree((state) => state.camera);

  useFrame(() => {
    const key = `${size.width}x${size.height}`;
    if (fitted.current === key) return;
    const controls = controlsRef.current;
    if (!controls || !(camera instanceof THREE.PerspectiveCamera)) return;
    const aspect = size.width / Math.max(size.height, 1);
    const narrow = aspect < 0.85;
    const short = size.height < 520;
    camera.fov = narrow ? 36 : short ? 34 : 30;
    camera.updateProjectionMatrix();
    const halfWidth = Math.tan(MathUtils.degToRad(camera.fov / 2)) * aspect;
    const distance = narrow
      ? MathUtils.clamp(5.2 / Math.max(halfWidth, 0.08), 30, 40)
      : short ? 40 : 34;
    controls.target.set(0, narrow ? -2.05 : -1.1, 0);
    controls.minDistance = narrow ? 28 : 18;
    controls.maxDistance = narrow ? 64 : 48;
    const offset = new THREE.Vector3().setFromSpherical(new THREE.Spherical(
      distance,
      narrow ? 1.36 : 1.48,
      controls.getAzimuthalAngle(),
    ));
    camera.position.copy(controls.target).add(offset);
    controls.update();
    fitted.current = key;
  });

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const spin = MathUtils.clamp(motion.current.spin, -0.03, 0.03);
    const tilt = MathUtils.clamp(motion.current.tilt, -0.02, 0.02);
    motion.current.spin = 0;
    motion.current.tilt = 0;
    if (spin) controls.setAzimuthalAngle(controls.getAzimuthalAngle() + spin);
    if (tilt) controls.setPolarAngle(MathUtils.clamp(controls.getPolarAngle() + tilt, 1.05, 1.72));
    controls.update();
    void delta;
  });

  return (
    <>
      <color attach="background" args={[CONFIG.colors.night]} />
      <fog attach="fog" args={[CONFIG.colors.night, 46, 98]} />
      <hemisphereLight args={['#d5e4ef', '#1c3b2c', 0.28]} />
      <ambientLight intensity={0.32} color="#d5e0d8" />
      <pointLight position={[4.5, 7.5, 12]} intensity={150} color="#ffe0b8" decay={2} />
      <pointLight position={[-8, 2.5, 7]} intensity={48} color="#b7c7d4" decay={2} />

      <Stars radius={62} depth={24} count={1800} factor={3.4} saturation={0} fade speed={reducedMotion ? 0 : 0.35} />
      <Suspense fallback={null}>
        <Environment preset="apartment" environmentIntensity={0.38} />
      </Suspense>
      <Snowfall enabled={snow} reducedMotion={reducedMotion} />

      <OrbitControls
        ref={controlsRef}
        enabled={controlsEnabled}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        target={[0, -1.1, 0]}
        minDistance={18}
        maxDistance={48}
        minPolarAngle={1.05}
        maxPolarAngle={1.72}
        autoRotate={autoRotate}
        autoRotateSpeed={0.55}
      />

      <group position={[0, -1.1, 0]}>
        <Room reducedMotion={reducedMotion} />
        <TreeBody mode={mode} reducedMotion={reducedMotion} />
        <Foliage mode={mode} reducedMotion={reducedMotion} />
        <LightRise mode={mode} reducedMotion={reducedMotion} />
        <Garland mode={mode} reducedMotion={reducedMotion} />
        <Baubles mode={mode} reducedMotion={reducedMotion} />
        <Gifts />
        <Star mode={mode} reducedMotion={reducedMotion} />
      </group>

      <EffectComposer multisampling={2}>
        <Bloom luminanceThreshold={0.5} luminanceSmoothing={0.22} intensity={0.62} radius={0.42} mipmapBlur />
        <Vignette eskil={false} offset={0.2} darkness={0.48} />
      </EffectComposer>
    </>
  );
}
