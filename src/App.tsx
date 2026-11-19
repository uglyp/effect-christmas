import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { useProgress } from '@react-three/drei';
import * as THREE from 'three';
import Experience from './Experience';
import GestureController from './GestureController';
import type { TreeMode } from './treeConfig';

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

function LoadLine() {
  const { active, progress } = useProgress();
  if (!active) return null;
  return (
    <div className="load" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-label="正在点亮圣诞树">
      <span style={{ width: `${Math.max(progress, 6)}%` }} />
    </div>
  );
}

export default function App() {
  const reducedMotion = useReducedMotion();
  const motion = useRef({ spin: 0, tilt: 0 });
  const [mode, setMode] = useState<TreeMode>('FORMED');
  const [gesture, setGesture] = useState(false);
  const [preview, setPreview] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (gesture) return;
    setPreview(false);
    setStatus('');
    motion.current.spin = 0;
    motion.current.tilt = 0;
  }, [gesture]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLButtonElement) return;
      if (event.code === 'Space') {
        event.preventDefault();
        setMode((current) => (current === 'FORMED' ? 'CHAOS' : 'FORMED'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const problem = /允许|没有|无法|失败/.test(status);
  const note = gesture ? (status || '正在准备手势') : '空格键也可以聚拢或散开';

  return (
    <div className="stage">
      <p className="sr-only">一棵可以旋转的圣诞树，灯火会沿树身向上流动。可以聚拢或散开。</p>
      <LoadLine />
      <div className="viewport">
        <Canvas
          dpr={[1, 1.6]}
          camera={{ position: [0, 0.35, 34], fov: 30, near: 0.1, far: 180 }}
          gl={{
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance',
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.08,
          }}
          onCreated={({ gl }) => {
            gl.outputColorSpace = THREE.SRGBColorSpace;
          }}
        >
          <Suspense fallback={null}>
            <Experience
              mode={mode}
              reducedMotion={reducedMotion}
              controlsEnabled
              autoRotate={!gesture && mode === 'FORMED' && !reducedMotion}
              motion={motion}
            />
          </Suspense>
        </Canvas>
      </div>

      <header className="mast">
        <p className="eyebrow">圣诞夜</p>
        <h1>圣诞树</h1>
      </header>

      <footer className="dock">
        <div className="dock-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setMode((current) => (current === 'FORMED' ? 'CHAOS' : 'FORMED'))}
          >
            {mode === 'FORMED' ? '散开' : '聚成树'}
          </button>
          <button type="button" className="btn" aria-pressed={gesture} onClick={() => setGesture((value) => !value)}>
            {gesture ? '关闭手势' : '开启手势'}
          </button>
          {gesture && (
            <button type="button" className="btn" aria-pressed={preview} onClick={() => setPreview((value) => !value)}>
              {preview ? '隐藏画面' : '摄像头'}
            </button>
          )}
        </div>
        <p className={problem ? 'dock-note is-error' : 'dock-note'} role="status">{note}</p>
        <p className="sr-only" aria-live="polite">{mode === 'FORMED' ? '圣诞树已聚拢' : '灯火已散开'}</p>
      </footer>

      {gesture && (
        <GestureController preview={preview} motion={motion} onMode={setMode} onStatus={setStatus} />
      )}
    </div>
  );
}
