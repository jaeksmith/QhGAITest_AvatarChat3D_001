import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';
import { VRMLoaderPlugin, VRM, VRMExpressionPresetName } from '@pixiv/three-vrm';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
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

/**
 * Detect format from URL/path
 */
function getAvatarFormat(url: string): 'vrm' | 'fbx' | 'glb' {
  const lower = url.toLowerCase();
  if (lower.endsWith('.fbx')) return 'fbx';
  if (lower.endsWith('.glb') || lower.endsWith('.gltf')) return 'glb';
  return 'vrm';
}

/**
 * Enhance FBX materials with PBR textures from alongside the FBX file.
 * Preserves existing FBX materials/mesh structure to avoid body-through-clothes artifacts.
 */
function enhanceFBXMaterials(model: THREE.Group, basePath: string, baseName: string) {
  const textureLoader = new THREE.TextureLoader();

  const diffusePath = `${basePath}/${baseName}_texture_0.png`;
  const normalPath = `${basePath}/${baseName}_texture_0_normal.png`;
  const roughnessPath = `${basePath}/${baseName}_texture_0_roughness.png`;
  const metallicPath = `${basePath}/${baseName}_texture_0_metallic.png`;

  // Log mesh structure for debugging
  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      console.log(`Mesh: "${mesh.name}" | Materials: ${mats.map((m) => `${m.name || '(unnamed)'} [${m.type}]`).join(', ')}`);
    }
  });

  // Load PBR textures
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
        // Convert Phong/Lambert to Standard for PBR support
        const stdMat = new THREE.MeshStandardMaterial();

        // Carry over existing properties
        if ('color' in mat) stdMat.color.copy((mat as THREE.MeshPhongMaterial).color);
        if ('opacity' in mat) stdMat.opacity = mat.opacity;
        if ('transparent' in mat) stdMat.transparent = mat.transparent;
        if ('alphaTest' in mat) stdMat.alphaTest = mat.alphaTest;
        stdMat.name = mat.name;

        // Preserve existing diffuse map or apply ours
        const existingMap = (mat as THREE.MeshPhongMaterial).map;
        stdMat.map = existingMap || diffuseMap;
        if (stdMat.map) stdMat.map.colorSpace = THREE.SRGBColorSpace;

        // Add PBR maps
        stdMat.normalMap = normalMap;
        stdMat.roughnessMap = roughnessMap;
        stdMat.metalnessMap = metallicMap;
        stdMat.roughness = 1.0;
        stdMat.metalness = 1.0;

        // Use FrontSide to prevent back-face bleed-through
        stdMat.side = THREE.FrontSide;

        return stdMat;
      });

      mesh.material = enhanced.length === 1 ? enhanced[0] : enhanced;
    }
  });
}

/**
 * Find jaw/mouth bone in skeleton for lip sync
 */
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
    const fbxModelRef = useRef<THREE.Group | null>(null);
    const fbxMixerRef = useRef<THREE.AnimationMixer | null>(null);
    const fbxActionsRef = useRef<Map<string, THREE.AnimationAction>>(new Map());
    const fbxMouthBoneRef = useRef<THREE.Bone | null>(null);
    const fbxMouthRestQuat = useRef<THREE.Quaternion>(new THREE.Quaternion());
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

      // Camera
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

      const format = getAvatarFormat(avatarUrl);

      // Frame camera on a loaded model
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
        // ──── FBX Loading ────
        const fbxLoader = new FBXLoader();
        fbxLoader.load(
          avatarUrl,
          (fbxModel) => {
            // FBX models from Meshy are often in cm scale (100x too large)
            const box = new THREE.Box3().setFromObject(fbxModel);
            const height = box.getSize(new THREE.Vector3()).y;
            if (height > 10) {
              const scale = 1.7 / height; // normalize to ~1.7m tall
              fbxModel.scale.setScalar(scale);
            }

            scene.add(fbxModel);
            fbxModelRef.current = fbxModel;

            // Apply PBR textures
            const urlParts = avatarUrl.split('/');
            urlParts.pop(); // remove filename
            const basePath = urlParts.join('/');
            // Derive base name from the directory
            const dirName = urlParts[urlParts.length - 1] || '';
            const baseName = dirName || 'avatar';
            enhanceFBXMaterials(fbxModel, basePath, baseName);

            // Find mouth/jaw bone for lip sync
            const mouthBone = findMouthBone(fbxModel);
            if (mouthBone) {
              fbxMouthBoneRef.current = mouthBone;
              fbxMouthRestQuat.current.copy(mouthBone.quaternion);
            }

            // Set up animation mixer
            const mixer = new THREE.AnimationMixer(fbxModel);
            fbxMixerRef.current = mixer;

            // Load embedded animations if any
            if (fbxModel.animations.length > 0) {
              fbxModel.animations.forEach((clip, i) => {
                const name = clip.name || `anim_${i}`;
                const action = mixer.clipAction(clip);
                fbxActionsRef.current.set(name, action);
                console.log(`Found animation: ${name} (${clip.duration.toFixed(1)}s)`);
              });
              // Play idle/first animation
              const idleAction =
                fbxActionsRef.current.get('idle') ||
                fbxActionsRef.current.get('Idle') ||
                fbxActionsRef.current.values().next().value;
              if (idleAction) {
                idleAction.play();
              }
            }

            // Also try loading the separate animations FBX
            const animUrl = avatarUrl.replace('_Character_output.fbx', '_Meshy_AI_Meshy_Merged_Animations.fbx');
            if (animUrl !== avatarUrl) {
              const animLoader = new FBXLoader();
              animLoader.load(
                animUrl,
                (animFbx) => {
                  console.log(`Loaded ${animFbx.animations.length} animations from separate file`);
                  animFbx.animations.forEach((clip, i) => {
                    const name = clip.name || `ext_anim_${i}`;
                    const action = mixer.clipAction(clip);
                    fbxActionsRef.current.set(name, action);
                    console.log(`  Animation: ${name} (${clip.duration.toFixed(1)}s)`);
                  });

                  // If no animation is playing yet, play the first one
                  if (fbxModel.animations.length === 0) {
                    const firstAction = fbxActionsRef.current.values().next().value;
                    if (firstAction) {
                      firstAction.play();
                    }
                  }
                },
                undefined,
                (err) => {
                  console.log('No separate animations file found (optional):', err);
                }
              );
            }

            frameCamera(fbxModel);
            onLoadedRef.current?.();
          },
          undefined,
          (error) => {
            console.error('Error loading FBX:', error);
            onErrorRef.current?.(`Failed to load FBX avatar: ${error}`);
          }
        );
      } else {
        // ──── VRM / GLB Loading ────
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
            onLoadedRef.current?.();
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

        // VRM update
        if (vrmRef.current) {
          const vrm = vrmRef.current;
          const expressionManager = vrm.expressionManager;

          if (expressionManager) {
            const target = targetExpressionRef.current;
            const current = currentExpressionRef.current;

            if (target !== current) {
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

              if (target !== 'neutral') {
                const targetValue =
                  expressionManager.getValue(EXPRESSION_MAP[target]) ?? 0;
                expressionManager.setValue(
                  EXPRESSION_MAP[target],
                  Math.min(1, targetValue + delta * 4)
                );
              }
            }

            const mouthTarget = mouthValueRef.current;
            try {
              expressionManager.setValue('aa', mouthTarget * 0.7);
              expressionManager.setValue('oh', mouthTarget * 0.3);
            } catch {
              // Some models may not have these visemes
            }

            const blinkCycle = Math.sin(Date.now() * 0.001 * 0.5) > 0.97;
            expressionManager.setValue(
              VRMExpressionPresetName.Blink,
              blinkCycle ? 1 : 0
            );
          }

          vrm.update(delta);
        }

        // FBX update
        if (fbxMixerRef.current) {
          fbxMixerRef.current.update(delta);
        }

        // FBX jaw-based lip sync
        if (fbxMouthBoneRef.current) {
          const mouthTarget = mouthValueRef.current;
          const bone = fbxMouthBoneRef.current;
          const openQuat = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(1, 0, 0),
            mouthTarget * 0.3 // ~17 degrees max opening
          );
          bone.quaternion
            .copy(fbxMouthRestQuat.current)
            .multiply(openQuat);
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
        fbxMixerRef.current = null;
        fbxModelRef.current = null;
        fbxMouthBoneRef.current = null;
        fbxActionsRef.current.clear();
        vrmRef.current = null;
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
