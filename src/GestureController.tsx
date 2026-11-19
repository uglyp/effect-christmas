import { useEffect, useRef, type MutableRefObject } from 'react';
import { GestureRecognizer, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';
import type { TreeMode } from './treeConfig';

interface Motion {
  spin: number;
  tilt: number;
}

interface GestureControllerProps {
  preview: boolean;
  motion: MutableRefObject<Motion>;
  onMode: (mode: TreeMode) => void;
  onStatus: (status: string) => void;
}

const READY = '张手散开，握拳聚拢。画面只留在这台设备上。';

export default function GestureController({ preview, motion, onMode, onStatus }: GestureControllerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef(preview);
  previewRef.current = preview;

  useEffect(() => {
    let recognizer: GestureRecognizer | null = null;
    let frame = 0;
    let cancelled = false;
    let phase = '';
    let applied = '';
    let lockedUntil = 0;
    let cameraPausedUntil = 0;
    let lastX = -1;
    let lastY = -1;
    const votes: string[] = [];

    const setPhase = (next: string) => {
      if (phase === next) return;
      phase = next;
      onStatus(next);
    };

    const stopStream = () => {
      const video = videoRef.current;
      const stream = video?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((track) => track.stop());
      if (video) video.srcObject = null;
    };

    const predict = () => {
      if (cancelled || !recognizer || !videoRef.current || !canvasRef.current) return;
      const video = videoRef.current;
      if (video.readyState >= 2 && video.videoWidth > 0) {
        const results = recognizer.recognizeForVideo(video, performance.now());
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (previewRef.current && context) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          context.clearRect(0, 0, canvas.width, canvas.height);
          const drawer = new DrawingUtils(context);
          for (const landmarks of results.landmarks ?? []) {
            drawer.drawConnectors(landmarks, GestureRecognizer.HAND_CONNECTIONS, { color: '#E4C27A', lineWidth: 2 });
            drawer.drawLandmarks(landmarks, { color: '#F3EBDD', radius: 2 });
          }
        }

        const now = performance.now();
        const gesture = results.gestures[0]?.[0];
        const name = gesture && gesture.score > 0.5 ? gesture.categoryName : '';
        if (name === 'Open_Palm' || name === 'Closed_Fist') {
          votes.push(name);
          if (votes.length > 10) votes.shift();
          let palms = 0;
          let fists = 0;
          for (const vote of votes) {
            if (vote === 'Open_Palm') palms += 1;
            else fists += 1;
          }
          const next = palms >= 6 && palms > fists ? 'CHAOS' : fists >= 6 && fists > palms ? 'FORMED' : '';
          if (next && next !== applied && now >= lockedUntil) {
            applied = next;
            lockedUntil = now + 450;
            cameraPausedUntil = now + 380;
            votes.length = 0;
            motion.current.spin = 0;
            motion.current.tilt = 0;
            onMode(next);
          }
        }

        const wrist = results.landmarks?.[0]?.[0];
        if (wrist && now >= cameraPausedUntil) {
          if (lastX < 0) {
            lastX = wrist.x;
            lastY = wrist.y;
          } else {
            const rawDx = wrist.x - lastX;
            const rawDy = wrist.y - lastY;
            if (Math.abs(rawDx) > 0.045 || Math.abs(rawDy) > 0.045) {
              lastX = wrist.x;
              lastY = wrist.y;
            } else {
              const smoothX = lastX + rawDx * 0.35;
              const smoothY = lastY + rawDy * 0.35;
              const dx = smoothX - lastX;
              const dy = smoothY - lastY;
              lastX = smoothX;
              lastY = smoothY;
              if (Math.abs(dx) > 0.0008) motion.current.spin += -dx * 2.4;
              if (Math.abs(dy) > 0.0008) motion.current.tilt += dy * 0.85;
            }
          }
        } else if (!wrist) {
          lastX = -1;
          lastY = -1;
        }
      }
      frame = requestAnimationFrame(predict);
    };

    const setup = async () => {
      setPhase('正在准备手势');
      try {
        const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm');
        if (cancelled) return;
        recognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 1,
        });
        if (cancelled) {
          recognizer.close();
          return;
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          setPhase('这台设备没有摄像头');
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setPhase(READY);
        predict();
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (/denied|permission|notallowed/i.test(message)) setPhase('需要允许摄像头。允许后可再点一次开启手势。');
        else if (/model|fetch|network|failed/i.test(message)) setPhase('手势模型没有载入。树仍可以用按钮控制。');
        else setPhase('摄像头没有打开。树仍可以用按钮控制。');
      }
    };

    setup();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      try { recognizer?.close(); } catch { /* already closed */ }
      stopStream();
    };
  }, [motion, onMode, onStatus]);

  return (
    <div className={preview ? 'camera-slot' : 'camera-slot is-hidden'} aria-hidden="true">
      <p className="camera-label">摄像头</p>
      <div className="camera-preview">
        <video ref={videoRef} playsInline muted autoPlay />
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
