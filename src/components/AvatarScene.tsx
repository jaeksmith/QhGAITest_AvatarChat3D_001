import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';
import { VRMLoaderPlugin, VRM, VRMExpressionPresetName } from '@pixiv/three-vrm';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Expression } from '../types';

export interface AvatarSceneHandle {
  setExpression: (expression: Expression) => void;
  setMouthOpen: (value: number) => void;
}

interface AvatarSceneProps {
  avatarUrl: string;
  onLoaded?: () => void;
  onError?: (error: string) => void;
}

// Map our expression names to VRM preset names
const EXPRESSION_MAP: Record<Expression, VRMExpressionPresetName> = {
  neutral: VRMExpressionPresetName.Neutral,
  happy: VRMExpressionPresetName.Happy,
  sad: VRMExpressionPresetName.Sad,
  angry: VRMExpressionPresetName.Angry,
  surprised: VRMExpressionPresetName.Surprised,
  relaxed: VRMExpressionPresetName.Relaxed,
};

const AvatarScene = forwardRef<AvatarSceneHandle, AvatarSceneProps>(
  ({ avatarUrl, onLoaded, onError }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const vrmRef = useRef<VRM | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const clockRef = useRef(new THREE.Clock());
    const currentExpressionRef = useRef<Expression>('neutral');
    const targetExpressionRef = useRef<Expression>('neutral');
    const mouthValueRef = useRef(0);
    const animFrameRef = useRef<number>(0);
    const onLoadedRef = useRef(onLoaded);
    const onErrorRef = useRef(onError);

    // Keep callback refs up to date without triggering effect re-runs
    onLoadedRef.current = onLoaded;
    onErrorRef.current = onError;

    const setExpression = useCallback((expression: Expression) => {
      targetExpressionRef.current = expression;
    }, []);

    const setMouthOpen = useCallback((value: number) => {
      mouthValueRef.current = value;
    }, []);

    useImperativeHandle(ref, () => ({
      setExpression,
      setMouthOpen,
    }));

    useEffect(() => {
      if (!containerRef.current) return;

      const container = containerRef.current;
      const width = container.clientWidth;
      const height = container.clientHeight;

      // Scene setup
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1a1a2e);
      sceneRef.current = scene;

      // Camera - pulled back for full body view
      const camera = new THREE.PerspectiveCamera(20, width / height, 0.1, 100);
      camera.position.set(0, 1.2, 3.5);
      cameraRef.current = camera;

      // Renderer
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      // Controls
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 1.0, 0);
      controls.enableDamping = true;
      controls.dampingFactor = 0.1;
      controls.update();
      controlsRef.current = controls;

      // Lighting
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
      scene.add(ambientLight);

      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
      directionalLight.position.set(1, 2, 1);
      scene.add(directionalLight);

      const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
      fillLight.position.set(-1, 1, -1);
      scene.add(fillLight);

      // Grid floor
      const gridHelper = new THREE.GridHelper(10, 10, 0x444466, 0x333355);
      scene.add(gridHelper);

      // Load VRM
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));

      loader.load(
        avatarUrl,
        (gltf) => {
          const vrm = gltf.userData.vrm as VRM;
          if (!vrm) {
            onErrorRef.current?.('Failed to parse VRM from file');
            return;
          }

          scene.add(vrm.scene);
          vrmRef.current = vrm;

          // Auto-frame: compute bounding box and position camera
          const box = new THREE.Box3().setFromObject(vrm.scene);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());

          // Position camera to see full body with some margin
          const distance = Math.max(size.y * 2.5, 2.5);
          camera.position.set(0, center.y, distance);
          controls.target.set(0, center.y, 0);
          controls.update();

          onLoadedRef.current?.();
        },
        undefined,
        (error) => {
          console.error('Error loading VRM:', error);
          onErrorRef.current?.(`Failed to load avatar: ${error}`);
        }
      );

      // Animation loop
      const animate = () => {
        animFrameRef.current = requestAnimationFrame(animate);
        const delta = clockRef.current.getDelta();

        if (vrmRef.current) {
          const vrm = vrmRef.current;
          const expressionManager = vrm.expressionManager;

          if (expressionManager) {
            // Smoothly transition expressions
            const target = targetExpressionRef.current;
            const current = currentExpressionRef.current;

            if (target !== current) {
              // Fade out current expression
              const currentValue =
                expressionManager.getValue(EXPRESSION_MAP[current]) ?? 0;
              if (currentValue > 0.01) {
                expressionManager.setValue(
                  EXPRESSION_MAP[current],
                  Math.max(0, currentValue - delta * 4)
                );
              } else {
                expressionManager.setValue(EXPRESSION_MAP[current], 0);
                currentExpressionRef.current = target;
              }

              // Fade in target expression
              if (target !== 'neutral') {
                const targetValue =
                  expressionManager.getValue(EXPRESSION_MAP[target]) ?? 0;
                expressionManager.setValue(
                  EXPRESSION_MAP[target],
                  Math.min(1, targetValue + delta * 4)
                );
              }
            }

            // Mouth / lip sync via the 'aa' viseme or mouth open blend shape
            const mouthTarget = mouthValueRef.current;
            try {
              expressionManager.setValue('aa', mouthTarget * 0.7);
              expressionManager.setValue('oh', mouthTarget * 0.3);
            } catch {
              // Some models may not have these visemes
            }

            // Idle eye blink
            const blinkCycle = Math.sin(Date.now() * 0.001 * 0.5) > 0.97;
            expressionManager.setValue(
              VRMExpressionPresetName.Blink,
              blinkCycle ? 1 : 0
            );
          }

          vrm.update(delta);
        }

        controls.update();
        renderer.render(scene, camera);
      };

      animate();

      // Handle resize
      const handleResize = () => {
        if (!container) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
        cancelAnimationFrame(animFrameRef.current);
        renderer.dispose();
        if (container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
      };
    }, [avatarUrl]); // Only re-run when avatar URL changes

    return (
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          borderRadius: '12px',
          overflow: 'hidden',
        }}
      />
    );
  }
);

AvatarScene.displayName = 'AvatarScene';
export default AvatarScene;
