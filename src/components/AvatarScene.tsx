import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';
import { VRMLoaderPlugin, VRM, VRMExpressionPresetName } from '@pixiv/three-vrm';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Expression } from '../types';
import { AnimationController, loadAnimationMap } from '../services/animationController';

export interface AvatarSceneHandle {
  setExpression: (expression: Expression) => void;
  setMouthOpen: (value: number) => void;
  playAnimation: (token: string) => boolean;
  startTalking: () => void;
  stopTalking: () => void;
  getAvailableAnimations: () => string[];
}

interface AvatarSceneProps {
  avatarUrl: string;
  onLoaded?: (availableAnimations: string[]) => void;
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

function getAvatarFormat(url: string): 'vrm' | 'fbx' | 'glb' {
  const lower = url.toLowerCase();
  if (lower.endsWith('.fbx')) return 'fbx';
  if (lower.endsWith('.glb') || lower.endsWith('.gltf')) return 'glb';
  return 'vrm';
}

function enhanceFBXMaterials(model: THREE.Group, basePath: string, baseName: string) {
  const textureLoader = new THREE.TextureLoader();

  const diffusePath = `${basePath}/${baseName}_texture_0.png`;
  const normalPath = `${basePath}/${baseName}_texture_0_normal.png`;
  const roughnessPath = `${basePath}/${baseName}_texture_0_roughness.png`;
  const metallicPath = `${basePath}/${baseName}_texture_0_metallic.png`;

  const diffuseMap = textureLoader.load(diffusePath);
  diffuseMap.colorSpace = THREE.SRGBColorSpace;
  const normalMap = textureLoader.load(normalPath);
  const roughnessMap = textureLoader.load(roughnessPath);
  const metallicMap = textureLoader.load(metallicPath);

  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

      const enhanced = materials.map((mat) => {
        const stdMat = new THREE.MeshStandardMaterial();
        if ('color' in mat) stdMat.color.copy((mat as THREE.MeshPhongMaterial).color);
        if ('opacity' in mat) stdMat.opacity = mat.opacity;
        if ('transparent' in mat) stdMat.transparent = mat.transparent;
        if ('alphaTest' in mat) stdMat.alphaTest = mat.alphaTest;
        stdMat.name = mat.name;

        const existingMap = (mat as THREE.MeshPhongMaterial).map;
        stdMat.map = existingMap || diffuseMap;
        if (stdMat.map) stdMat.map.colorSpace = THREE.SRGBColorSpace;

        stdMat.normalMap = normalMap;
        stdMat.roughnessMap = roughnessMap;
        stdMat.metalnessMap = metallicMap;
        stdMat.roughness = 1.0;
        stdMat.metalness = 1.0;
        stdMat.side = THREE.FrontSide;

        return stdMat;
      });

      mesh.material = enhanced.length === 1 ? enhanced[0] : enhanced;
    }
  });
}

function findMouthBone(model: THREE.Group): THREE.Bone | null {
  let mouthBone: THREE.Bone | null = null;
  const mouthNames = ['jaw', 'mouth', 'chin', 'head_jaw', 'jaw_open', 'lower_jaw'];
  model.traverse((child) => {
    if ((child as THREE.Bone).isBone && !mouthBone) {
      const name = child.name.toLowerCase();
      if (mouthNames.some((n) => name.includes(n))) {
        mouthBone = child as THREE.Bone;
      }
    }
  });
  return mouthBone;
}

const AvatarScene = forwardRef<AvatarSceneHandle, AvatarSceneProps>(
  ({ avatarUrl, onLoaded, onError }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const vrmRef = useRef<VRM | null>(null);
    const animControllerRef = useRef<AnimationController | null>(null);
    const fbxMouthBoneRef = useRef<THREE.Bone | null>(null);
    const fbxMouthRestQuat = useRef<THREE.Quaternion>(new THREE.Quaternion());
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const clockRef = useRef(new THREE.Clock());
    const currentExpressionRef = useRef<Expression>('neutral');
    const targetExpressionRef = useRef<Expression>('neutral');
    const mouthValueRef = useRef(0);
    const animFrameRef = useRef<number>(0);
    const onLoadedRef = useRef(onLoaded);
    const onErrorRef = useRef(onError);

    onLoadedRef.current = onLoaded;
    onErrorRef.current = onError;

    const setExpression = useCallback((expression: Expression) => {
      targetExpressionRef.current = expression;
    }, []);

    const setMouthOpen = useCallback((value: number) => {
      mouthValueRef.current = value;
    }, []);

    const playAnimation = useCallback((token: string): boolean => {
      return animControllerRef.current?.playToken(token) ?? false;
    }, []);

    const startTalking = useCallback(() => {
      animControllerRef.current?.startTalking();
    }, []);

    const stopTalking = useCallback(() => {
      animControllerRef.current?.stopTalking();
    }, []);

    const getAvailableAnimations = useCallback((): string[] => {
      return animControllerRef.current?.getAvailableTokens() ?? [];
    }, []);

    useImperativeHandle(ref, () => ({
      setExpression,
      setMouthOpen,
      playAnimation,
      startTalking,
      stopTalking,
      getAvailableAnimations,
    }));

    useEffect(() => {
      if (!containerRef.current) return;

      const container = containerRef.current;
      const width = container.clientWidth;
      const height = container.clientHeight;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1a1a2e);

      const camera = new THREE.PerspectiveCamera(20, width / height, 0.1, 100);
      camera.position.set(0, 1.2, 3.5);

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 1.0, 0);
      controls.enableDamping = true;
      controls.dampingFactor = 0.1;
      controls.update();

      // Lighting
      scene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
      dirLight.position.set(1, 2, 1);
      scene.add(dirLight);
      const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
      fillLight.position.set(-1, 1, -1);
      scene.add(fillLight);

      scene.add(new THREE.GridHelper(10, 10, 0x444466, 0x333355));

      const format = getAvatarFormat(avatarUrl);

      const frameCamera = (object: THREE.Object3D) => {
        const box = new THREE.Box3().setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const distance = Math.max(size.y * 2.5, 2.5);
        camera.position.set(0, center.y, distance);
        controls.target.set(0, center.y, 0);
        controls.update();
      };

      if (format === 'fbx') {
        const fbxLoader = new FBXLoader();
        fbxLoader.load(
          avatarUrl,
          async (fbxModel) => {
            // Scale
            const box = new THREE.Box3().setFromObject(fbxModel);
            const modelHeight = box.getSize(new THREE.Vector3()).y;
            if (modelHeight > 10) {
              fbxModel.scale.setScalar(1.7 / modelHeight);
            }

            scene.add(fbxModel);

            // Textures
            const urlParts = avatarUrl.split('/');
            urlParts.pop();
            const basePath = urlParts.join('/');
            const dirName = urlParts[urlParts.length - 1] || '';
            enhanceFBXMaterials(fbxModel, basePath, dirName);

            // Mouth bone
            const mouthBone = findMouthBone(fbxModel);
            if (mouthBone) {
              fbxMouthBoneRef.current = mouthBone;
              fbxMouthRestQuat.current.copy(mouthBone.quaternion);
            }

            // Animation controller
            const mixer = new THREE.AnimationMixer(fbxModel);
            const controller = new AnimationController(mixer);
            animControllerRef.current = controller;

            // Register embedded clips
            fbxModel.animations.forEach((clip) => {
              controller.registerClip(clip.name, clip);
            });

            // Load animation map first to know which clips to load
            const animMap = await loadAnimationMap();

            // Derive base prefix for animation files
            // e.g. "Meshy_AI_Hot_young_muscular_bi_biped" from the character FBX name
            const charFileName = avatarUrl.split('/').pop() || '';
            const basePrefix = charFileName.replace('_Character_output.fbx', '');

            // Collect unique clip names from the animation map
            const clipNames = new Set<string>();
            for (const entry of Object.values(animMap)) {
              clipNames.add(entry.clip);
            }

            // Load each animation from its own FBX file
            const animLoader = new FBXLoader();
            const loadPromises = Array.from(clipNames).map(async (clipName) => {
              // Build the expected filename: {basePrefix}_Animation_{clipName}_withSkin.fbx
              const animFileName = `${basePrefix}_Animation_${clipName}_withSkin.fbx`;
              const animUrl = `${basePath}/${animFileName}`;

              try {
                const animFbx = await new Promise<THREE.Group>((resolve, reject) => {
                  animLoader.load(animUrl, resolve, undefined, reject);
                });
                if (animFbx.animations.length > 0) {
                  // Use the clip name from the map as the registered name
                  controller.registerClip(clipName, animFbx.animations[0]);
                  console.log(`Loaded animation: ${clipName} (${animFbx.animations[0].duration.toFixed(1)}s)`);
                }
              } catch {
                console.warn(`Could not load animation file: ${animFileName}`);
              }
            });

            await Promise.all(loadPromises);

            controller.setAnimationMap(animMap);
            controller.startIdle();

            frameCamera(fbxModel);
            onLoadedRef.current?.(controller.getAvailableTokens());
          },
          undefined,
          (error) => {
            console.error('Error loading FBX:', error);
            onErrorRef.current?.(`Failed to load FBX avatar: ${error}`);
          }
        );
      } else {
        // VRM / GLB
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
            frameCamera(vrm.scene);
            onLoadedRef.current?.([]);
          },
          undefined,
          (error) => {
            console.error('Error loading VRM:', error);
            onErrorRef.current?.(`Failed to load avatar: ${error}`);
          }
        );
      }

      // ──── Animation Loop ────
      const animate = () => {
        animFrameRef.current = requestAnimationFrame(animate);
        const delta = clockRef.current.getDelta();

        // VRM expressions
        if (vrmRef.current) {
          const vrm = vrmRef.current;
          const em = vrm.expressionManager;
          if (em) {
            const target = targetExpressionRef.current;
            const current = currentExpressionRef.current;
            if (target !== current) {
              const cv = em.getValue(EXPRESSION_MAP[current]) ?? 0;
              if (cv > 0.01) {
                em.setValue(EXPRESSION_MAP[current], Math.max(0, cv - delta * 4));
              } else {
                em.setValue(EXPRESSION_MAP[current], 0);
                currentExpressionRef.current = target;
              }
              if (target !== 'neutral') {
                const tv = em.getValue(EXPRESSION_MAP[target]) ?? 0;
                em.setValue(EXPRESSION_MAP[target], Math.min(1, tv + delta * 4));
              }
            }
            const mouthTarget = mouthValueRef.current;
            try {
              em.setValue('aa', mouthTarget * 0.7);
              em.setValue('oh', mouthTarget * 0.3);
            } catch { /* no visemes */ }

            const blinkCycle = Math.sin(Date.now() * 0.001 * 0.5) > 0.97;
            em.setValue(VRMExpressionPresetName.Blink, blinkCycle ? 1 : 0);
          }
          vrm.update(delta);
        }

        // FBX animation controller update
        if (animControllerRef.current) {
          animControllerRef.current.update(delta);
        }

        // FBX jaw lip sync
        if (fbxMouthBoneRef.current) {
          const mouthTarget = mouthValueRef.current;
          const bone = fbxMouthBoneRef.current;
          const openQuat = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(1, 0, 0),
            mouthTarget * 0.3
          );
          bone.quaternion.copy(fbxMouthRestQuat.current).multiply(openQuat);
        }

        controls.update();
        renderer.render(scene, camera);
      };

      animate();

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
        animControllerRef.current = null;
        fbxMouthBoneRef.current = null;
        vrmRef.current = null;
        if (container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
      };
    }, [avatarUrl]);

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
