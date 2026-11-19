import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { extend as extendFiber, useFrame } from '@react-three/fiber';
import { Environment, OrbitControls, Stars, shaderMaterial } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { MathUtils, ShaderMaterial, type Group, type Mesh, type Points } from 'three';
import * as THREE from 'three';
import * as random from 'maath/random';
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
    varying float vRandom;
    varying float vMix;
    varying float vHeight;
    float cubicInOut(float t) {
      return t < 0.5 ? 4.0 * t * t * t : 0.5 * pow(2.0 * t - 2.0, 3.0) + 1.0;
    }
    void main() {
      vRandom = aRandom;
      vHeight = aTargetPos.y;
      float t = cubicInOut(clamp(uProgress, 0.0, 1.0));
      vMix = t;
      float sway = sin(uTime * 1.05 + aTargetPos.y * 0.65 + aRandom * 6.2831) * 0.055 * t;
      vec3 formed = aTargetPos;
      formed.x += sway;
      formed.z += cos(uTime * 0.85 + aRandom * 7.0) * 0.055 * t;
      vec3 finalPos = mix(position, formed, t);
      vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
      gl_PointSize = clamp((310.0 * (0.4 + aRandom * 0.9)) / max(1.0, -mvPosition.z), 2.2, 11.0);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragment: `
    uniform float uTime;
    varying float vRandom;
    varying float vMix;
    varying float vHeight;
    void main() {
      float dist = distance(gl_PointCoord, vec2(0.5));
      if (dist > 0.5) discard;
      float glow = pow(1.0 - smoothstep(0.0, 0.5, dist), 1.45);
      float twinkle = pow(0.5 + 0.5 * sin(uTime * (1.2 + vRandom * 6.5) + vRandom * 48.0), 3.0);
      float spark = mix(0.72, 0.25 + twinkle, smoothstep(0.55, 0.92, vRandom));
      vec3 pine = vec3(0.015, 0.28, 0.09);
      vec3 bright = vec3(0.22, 1.05, 0.48);
      vec3 gold = vec3(1.15, 0.78, 0.28);
      vec3 color = mix(pine, bright, 0.28 + 0.72 * vRandom);
      color = mix(color, gold, smoothstep(0.9, 0.98, vRandom));
      color *= spark * mix(0.45, 1.25, vMix);
      float yNorm = clamp((vHeight + 6.1) / 12.2, 0.0, 1.0);
      float sweep = fract(uTime * 0.2);
      float along = min(abs(yNorm - sweep), 1.0 - abs(yNorm - sweep));
      float band = exp(-along * along * 55.0);
      color += vec3(0.25, 1.2, 0.55) * band * vMix;
      float alpha = glow * mix(0.45, 1.0, vMix);
      gl_FragColor = vec4(color * alpha, alpha);
    }
  `,
};

const FoliageShader = shaderMaterial(foliageShader.uniforms, foliageShader.vertex, foliageShader.fragment);
extendFiber({ FoliageMaterial: FoliageShader });

function treeTarget(index: number) {
  const { height, radius } = CONFIG.tree;
  const yNorm = 0.05 + 0.92 * Math.pow(hashUnit(index, 4), 0.82);
  const y = yNorm * height - height / 2;
  const cone = radius * Math.pow(1 - yNorm, 0.94);
  const shelf = 0.9 + 0.1 * Math.sin(yNorm * Math.PI * 8);
  const rim = 0.84 + 0.16 * Math.pow(hashUnit(index, 6), 0.65);
  const radial = cone * shelf * rim;
  const theta = hashUnit(index, 7) * Math.PI * 2;
  return [Math.cos(theta) * radial, y, Math.sin(theta) * radial] as const;
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
      <coneGeometry args={[CONFIG.tree.radius * 0.74, height, 56]} />
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
        fragmentShader={`
          uniform float uTime;
          varying vec3 vLocal;
          void main() {
            float angle = atan(vLocal.z, vLocal.x);
            float filament = sin(vLocal.y * 8.5 - uTime * 2.6 + angle * 5.0);
            float line = smoothstep(0.78, 0.98, filament);
            float warm = smoothstep(0.9, 1.0, sin(vLocal.y * 4.2 + uTime * 1.5 - angle * 2.0));
            vec3 pine = vec3(0.003, 0.016, 0.009);
            vec3 color = pine;
            color += vec3(0.16, 0.72, 0.32) * line;
            color += vec3(1.0, 0.55, 0.16) * warm * 0.55;
            gl_FragColor = vec4(color, 1.0);
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
    const positions = random.inSphere(new Float32Array(count * 3), { radius: 8 }) as Float32Array;
    const targets = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const [x, y, z] = treeTarget(index);
      targets[index * 3] = x;
      targets[index * 3 + 1] = y;
      targets[index * 3 + 2] = z;
      randoms[index] = hashUnit(index, 8);
    }
    return { positions, targets, randoms };
  }, []);

  useFrame((state, delta) => {
    const material = materialRef.current;
    if (!material) return;
    material.uTime = reducedMotion ? 0 : state.clock.elapsedTime;
    const target = mode === 'FORMED' ? 1 : 0;
    material.uProgress = reducedMotion ? target : MathUtils.damp(material.uProgress, target, 1.45, delta);
  });

  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[buffers.positions, 3]} />
        <bufferAttribute attach="attributes-aTargetPos" args={[buffers.targets, 3]} />
        <bufferAttribute attach="attributes-aRandom" args={[buffers.randoms, 1]} />
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
    const palette = index % 9 === 0 ? '#ff4d4d' : index % 4 === 0 ? '#ffd27a' : '#fff1cf';
    const color = new THREE.Color(palette);
    return {
      t,
      point,
      base: { r: color.r, g: color.g, b: color.b },
      scale: index % 9 === 0 ? 0.13 : 0.08,
      speed: 1.4 + hashUnit(index, 2) * 2.8,
      offset: hashUnit(index, 3) * Math.PI * 2,
    };
  }), []);

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const target = mode === 'FORMED' ? 1 : 0.015;
    const next = reducedMotion ? target : MathUtils.damp(group.scale.x, target, 1.7, delta);
    group.scale.setScalar(Math.max(next, 0.001));
    const time = reducedMotion ? 0 : state.clock.elapsedTime;
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
      const head = Math.exp(-(wrap(bulb.t, pulseA) ** 2) * 140) + Math.exp(-(wrap(bulb.t, pulseB) ** 2) * 80) * 0.7;
      const flicker = 0.42 + 0.28 * (0.5 + 0.5 * Math.sin(time * bulb.speed + bulb.offset));
      const gain = flicker + head * 3.4;
      material.color.r = bulb.base.r * gain;
      material.color.g = bulb.base.g * gain;
      material.color.b = bulb.base.b * gain;
      mesh.scale.setScalar(bulb.scale * (1 + head * 0.9));
    });
  });

  return (
    <group ref={groupRef} scale={0.02}>
      <mesh geometry={cord}>
        <meshStandardMaterial color="#c9893a" emissive="#ffb45a" emissiveIntensity={0.85} roughness={0.32} metalness={0.55} toneMapped={false} />
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
  const materials = useMemo(() => BAUBLE_LOOKS.map((look) => new THREE.MeshStandardMaterial(look)), []);
  const data = useMemo(() => Array.from({ length: CONFIG.baubles }, (_, index) => {
    const yNorm = 0.08 + 0.84 * (index / (CONFIG.baubles - 1));
    const y = yNorm * CONFIG.tree.height - CONFIG.tree.height / 2;
    const radial = CONFIG.tree.radius * (1 - yNorm) * (0.9 + hashUnit(index, 2) * 0.12);
    const theta = index * 2.399963 + 1.15;
    const target = new THREE.Vector3(Math.cos(theta) * radial, y, Math.sin(theta) * radial);
    const chaos = new THREE.Vector3(
      (hashUnit(index, 3) - 0.5) * 18,
      (hashUnit(index, 4) - 0.5) * 14,
      (hashUnit(index, 5) - 0.5) * 18,
    );
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
    data.forEach((item, index) => {
      const mesh = group.children[index] as Mesh;
      if (!mesh) return;
      item.current.lerp(formed ? item.target : item.chaos, 1 - Math.exp(-delta * (formed ? 2.1 : 1.15)));
      mesh.position.copy(item.current);
      if (formed && !reducedMotion) mesh.position.y += Math.sin(state.clock.elapsedTime * item.speed + item.offset) * 0.045;
      mesh.rotation.y += delta * (reducedMotion ? 0 : 0.18);
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
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    const outer = 1.02;
    const inner = 0.46;
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
      depth: 0.22,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.05,
      bevelSegments: 2,
    });
    star.center();
    return star;
  }, []);

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const formed = mode === 'FORMED';
    const target = formed ? 1 : 0.001;
    const next = reducedMotion ? target : MathUtils.damp(group.scale.x, target, 2.4, delta);
    group.scale.setScalar(Math.max(next, 0.001));
    const baseY = CONFIG.tree.height / 2 + 1.05;
    group.position.y = baseY + (reducedMotion || !formed ? 0 : Math.sin(state.clock.elapsedTime * 0.8) * 0.04);
    if (formed) group.lookAt(state.camera.position);
  });

  const glow = useGlowTexture();

  return (
    <group ref={groupRef} position={[0, CONFIG.tree.height / 2 + 1.05, 0]} scale={0.001}>
      <mesh position={[0, 0, -0.15]}>
        <planeGeometry args={[3.6, 3.6]} />
        <meshBasicMaterial map={glow} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh geometry={geometry}>
        <meshStandardMaterial color="#ffe0a4" emissive="#ffb14a" emissiveIntensity={0.7} roughness={0.28} metalness={0.62} />
      </mesh>
      <pointLight color="#ffd59a" intensity={18} distance={7.5} decay={2} position={[0, 0, 0.3]} />
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
    gradient.addColorStop(0, 'rgba(255, 244, 214, 0.95)');
    gradient.addColorStop(0.22, 'rgba(255, 186, 74, 0.55)');
    gradient.addColorStop(0.55, 'rgba(255, 120, 30, 0.08)');
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
      const target = mode === 'FORMED' ? 1 : 0.2;
      const next = reducedMotion ? target : MathUtils.damp(group.scale.x || 0.2, target, 1.8, delta);
      group.scale.setScalar(Math.max(next, 0.05));
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

function Snowfall({ reducedMotion }: { reducedMotion: boolean }) {
  const ref = useRef<Points>(null);
  const speeds = useRef<Float32Array>(new Float32Array());
  const positions = useMemo(() => {
    const count = CONFIG.snow;
    const array = new Float32Array(count * 3);
    const speed = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const theta = hashUnit(index, 1) * Math.PI * 2;
      const radius = Math.sqrt(hashUnit(index, 2)) * 10.5;
      array[index * 3] = Math.cos(theta) * radius;
      array[index * 3 + 1] = -6 + hashUnit(index, 3) * 14;
      array[index * 3 + 2] = Math.sin(theta) * radius;
      speed[index] = 0.28 + hashUnit(index, 4) * 0.7;
    }
    speeds.current = speed;
    return array;
  }, []);

  useFrame((_, delta) => {
    if (reducedMotion || !ref.current) return;
    const attribute = ref.current.geometry.attributes.position;
    const array = attribute.array as Float32Array;
    const speed = speeds.current;
    for (let index = 0; index < speed.length; index += 1) {
      array[index * 3 + 1] -= speed[index] * delta;
      if (array[index * 3 + 1] < -6.4) array[index * 3 + 1] = 8.2;
    }
    attribute.needsUpdate = true;
  });

  return (
    <points ref={ref} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color={CONFIG.colors.snow} size={0.055} transparent opacity={0.62} depthWrite={false} sizeAttenuation />
    </points>
  );
}

export default function Experience({
  mode,
  reducedMotion,
  controlsEnabled,
  autoRotate,
  motion,
}: ExperienceProps) {
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);

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
      <Environment preset="apartment" environmentIntensity={0.38} />

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
        <Snowfall reducedMotion={reducedMotion} />
      </group>

      <EffectComposer multisampling={2}>
        <Bloom luminanceThreshold={0.35} luminanceSmoothing={0.18} intensity={0.85} radius={0.55} mipmapBlur />
        <Vignette eskil={false} offset={0.2} darkness={0.48} />
      </EffectComposer>
    </>
  );
}
