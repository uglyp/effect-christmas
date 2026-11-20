import { useEffect, useRef } from 'react';
import { GestureRecognizer, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';
import type { TreeMode } from './treeConfig';

interface GestureControllerProps {
  preview: boolean;
  mode: TreeMode;
  onMode: (mode: TreeMode) => void;
  onStatus: (status: string) => void;
}

const READY = '张手散开，握拳聚拢。画面只留在这台设备上。';
const VISION_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm';
const GESTURE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

const SCORE_MIN = 0.62;
const VOTE_WINDOW = 12;
const VOTE_NEED = 8;
const LOCK_MS = 700;

export default function GestureController({ preview, mode, onMode, onStatus }: GestureControllerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef(preview);
  const modeRef = useRef(mode);
  previewRef.current = preview;
  modeRef.current = mode;

  useEffect(() => {
    let recognizer: GestureRecognizer | null = null;
    let frame = 0;
    let cancelled = false;
    let phase = '';
    let lockedUntil = 0;
    let feedbackToken = 0;
    let feedbackTimer = 0;
    let drawer: DrawingUtils | null = null;
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

    const flashStatus = (message: string) => {
      const token = ++feedbackToken;
      setPhase(message);
      window.clearTimeout(feedbackTimer);
      feedbackTimer = window.setTimeout(() => {
        if (!cancelled && token === feedbackToken) setPhase(READY);
      }, 1600);
    };

    const decide = (now: number) => {
      if (now < lockedUntil || votes.length < VOTE_NEED) return;

      let palms = 0;
      let fists = 0;
      for (const vote of votes) {
        if (vote === 'Open_Palm') palms += 1;
        else if (vote === 'Closed_Fist') fists += 1;
      }

      const next: TreeMode | '' =
        palms >= VOTE_NEED && palms > fists
          ? 'CHAOS'
          : fists >= VOTE_NEED && fists > palms
            ? 'FORMED'
            : '';

      if (!next || next === modeRef.current) return;

      lockedUntil = now + LOCK_MS;
      votes.length = 0;
      onMode(next);
      flashStatus(next === 'CHAOS' ? '已散开 · 握拳可再聚拢' : '已聚拢 · 张手可再散开');
    };

    const predict = () => {
      if (cancelled || !recognizer || !videoRef.current || !canvasRef.current) return;
      const video = videoRef.current;
      if (video.readyState >= 2 && video.videoWidth > 0) {
        const results = recognizer.recognizeForVideo(video, performance.now());
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');

        if (previewRef.current && context) {
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }
          context.clearRect(0, 0, canvas.width, canvas.height);
          if (!drawer) drawer = new DrawingUtils(context);
          for (const landmarks of results.landmarks ?? []) {
            drawer.drawConnectors(landmarks, GestureRecognizer.HAND_CONNECTIONS, { color: '#E4C27A', lineWidth: 2 });
            drawer.drawLandmarks(landmarks, { color: '#F3EBDD', radius: 2 });
          }
        }

        const now = performance.now();
        if (now >= lockedUntil) {
          const gesture = results.gestures[0]?.[0];
          const name = gesture && gesture.score >= SCORE_MIN ? gesture.categoryName : '';
          if (name === 'Open_Palm' || name === 'Closed_Fist') {
            votes.push(name);
            if (votes.length > VOTE_WINDOW) votes.shift();
            decide(now);
          } else if (votes.length) {
            votes.shift();
          }
        }
      }
      frame = requestAnimationFrame(predict);
    };

    const setup = async () => {
      setPhase('正在准备手势');
      try {
        const vision = await FilesetResolver.forVisionTasks(VISION_WASM);
        if (cancelled) return;

        try {
          recognizer = await GestureRecognizer.createFromOptions(vision, {
            baseOptions: { modelAssetPath: GESTURE_MODEL, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numHands: 1,
          });
        } catch {
          recognizer = await GestureRecognizer.createFromOptions(vision, {
            baseOptions: { modelAssetPath: GESTURE_MODEL, delegate: 'CPU' },
            runningMode: 'VIDEO',
            numHands: 1,
          });
        }

        if (cancelled) {
          recognizer.close();
          return;
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          setPhase('这台设备没有摄像头');
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
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
      window.clearTimeout(feedbackTimer);
      try { recognizer?.close(); } catch { /* already closed */ }
      stopStream();
    };
  }, [onMode, onStatus]);

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
