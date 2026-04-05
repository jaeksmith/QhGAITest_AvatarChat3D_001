import * as THREE from 'three';

export interface AnimationMapEntry {
  clip: string;
  loop: boolean;
  category: 'idle' | 'action' | 'talk' | 'emote';
}

export type AnimationMap = Record<string, AnimationMapEntry>;

const CROSSFADE_DURATION = 0.4; // seconds
const IDLE_SWITCH_MIN = 8; // min seconds before switching idle
const IDLE_SWITCH_MAX = 20; // max seconds before switching idle

/**
 * Controls animation playback with crossfading, idle cycling, and LLM-triggered actions.
 */
export class AnimationController {
  private mixer: THREE.AnimationMixer;
  private actions: Map<string, THREE.AnimationAction> = new Map();
  private animationMap: AnimationMap = {};
  private currentAction: THREE.AnimationAction | null = null;
  private currentToken: string = '';
  private idleTokens: string[] = [];
  private idleTimer: number = 0;
  private nextIdleSwitch: number = 0;
  private isPlayingOneShot: boolean = false;
  private oneShotReturnToken: string = '';

  constructor(mixer: THREE.AnimationMixer) {
    this.mixer = mixer;

    // Listen for when looping-off animations finish
    this.mixer.addEventListener('finished', (e) => {
      const finishedAction = e.action as THREE.AnimationAction;
      if (this.isPlayingOneShot && finishedAction === this.currentAction) {
        this.isPlayingOneShot = false;
        // Return to idle or talk
        const returnTo = this.oneShotReturnToken || this.pickRandomIdle();
        if (returnTo) {
          this.playToken(returnTo);
        }
      }
    });
  }

  /**
   * Load animation map from JSON and register available clips.
   */
  setAnimationMap(map: AnimationMap) {
    this.animationMap = map;

    // Identify idle animations
    this.idleTokens = Object.entries(map)
      .filter(([, entry]) => entry.category === 'idle')
      .map(([token]) => token);

    this.scheduleNextIdleSwitch();
  }

  /**
   * Register an animation clip by name so it can be referenced by the map.
   */
  registerClip(name: string, clip: THREE.AnimationClip) {
    const action = this.mixer.clipAction(clip);
    this.actions.set(name, action);
  }

  /**
   * Get all available tokens from the animation map.
   */
  getAvailableTokens(): string[] {
    return Object.keys(this.animationMap);
  }

  /**
   * Get tokens by category.
   */
  getTokensByCategory(category: AnimationMapEntry['category']): string[] {
    return Object.entries(this.animationMap)
      .filter(([, entry]) => entry.category === category)
      .map(([token]) => token);
  }

  /**
   * Play an animation by its abstract token name.
   * Crossfades from the current animation.
   */
  playToken(token: string): boolean {
    const entry = this.animationMap[token];
    if (!entry) {
      console.warn(`Animation token "${token}" not found in map`);
      return false;
    }

    const action = this.actions.get(entry.clip);
    if (!action) {
      console.warn(`Animation clip "${entry.clip}" not loaded (token: "${token}")`);
      return false;
    }

    this.crossfadeTo(action, entry.loop, CROSSFADE_DURATION);
    this.currentToken = token;

    // Track one-shot animations so we can return to idle when they finish
    if (!entry.loop) {
      this.isPlayingOneShot = true;
    } else {
      this.isPlayingOneShot = false;
    }

    // Reset idle timer when explicitly playing something
    if (entry.category === 'idle') {
      this.scheduleNextIdleSwitch();
    }

    return true;
  }

  /**
   * Play an animation token, and when it finishes (if non-looping), return to this token.
   */
  playTokenWithReturn(token: string, returnToToken: string) {
    this.oneShotReturnToken = returnToToken;
    this.playToken(token);
  }

  /**
   * Start playing a talk animation. Called when TTS starts.
   */
  startTalking() {
    const talkTokens = this.getTokensByCategory('talk');
    if (talkTokens.length > 0) {
      const token = talkTokens[Math.floor(Math.random() * talkTokens.length)];
      this.oneShotReturnToken = '';
      this.playToken(token);
    }
  }

  /**
   * Stop talking and return to idle. Called when TTS ends.
   */
  stopTalking() {
    const idle = this.pickRandomIdle();
    if (idle) {
      this.playToken(idle);
    }
  }

  /**
   * Start idle cycling. Call this after loading is complete.
   */
  startIdle() {
    const idle = this.pickRandomIdle();
    if (idle) {
      this.playToken(idle);
    }
  }

  /**
   * Update - call each frame with delta time.
   * Handles idle rotation timing.
   */
  update(delta: number) {
    this.mixer.update(delta);

    // Idle cycling - only when in idle state and not playing a one-shot
    if (!this.isPlayingOneShot) {
      const currentEntry = this.animationMap[this.currentToken];
      if (currentEntry?.category === 'idle') {
        this.idleTimer += delta;
        if (this.idleTimer >= this.nextIdleSwitch) {
          const newIdle = this.pickRandomIdle(this.currentToken);
          if (newIdle) {
            this.playToken(newIdle);
          }
          this.scheduleNextIdleSwitch();
        }
      }
    }
  }

  // ─── Private ───

  private crossfadeTo(
    newAction: THREE.AnimationAction,
    loop: boolean,
    duration: number
  ) {
    newAction.reset();
    newAction.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    newAction.clampWhenFinished = !loop;

    if (this.currentAction && this.currentAction !== newAction) {
      newAction.enabled = true;
      newAction.setEffectiveTimeScale(1);
      newAction.setEffectiveWeight(1);
      newAction.play();
      this.currentAction.crossFadeTo(newAction, duration, true);
    } else {
      newAction.play();
    }

    this.currentAction = newAction;
  }

  private pickRandomIdle(excludeToken?: string): string | null {
    const candidates = this.idleTokens.filter((t) => t !== excludeToken);
    if (candidates.length === 0) {
      return this.idleTokens[0] || null;
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  private scheduleNextIdleSwitch() {
    this.idleTimer = 0;
    this.nextIdleSwitch =
      IDLE_SWITCH_MIN + Math.random() * (IDLE_SWITCH_MAX - IDLE_SWITCH_MIN);
  }
}

/**
 * Load the animation map from the public JSON file.
 */
export async function loadAnimationMap(): Promise<AnimationMap> {
  try {
    const response = await fetch('/animation-map.json');
    const raw = await response.json();

    // Filter out comment keys
    const map: AnimationMap = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!key.startsWith('_') && typeof value === 'object' && value !== null) {
        map[key] = value as AnimationMapEntry;
      }
    }

    console.log(`Loaded animation map: ${Object.keys(map).length} tokens`);
    return map;
  } catch (err) {
    console.error('Failed to load animation-map.json:', err);
    return {};
  }
}
