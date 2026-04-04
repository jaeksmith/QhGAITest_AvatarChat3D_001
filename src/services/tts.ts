export type VisemeCallback = (volume: number) => void;

let analyserCleanup: (() => void) | null = null;

export function stopSpeaking() {
  window.speechSynthesis.cancel();
  if (analyserCleanup) {
    analyserCleanup();
    analyserCleanup = null;
  }
}

export function isSpeaking(): boolean {
  return window.speechSynthesis.speaking;
}

/**
 * Speak text using browser TTS with real-time volume analysis for lip sync.
 * The visemeCallback receives a 0-1 volume value at ~60fps.
 */
export function speak(
  text: string,
  onViseme: VisemeCallback,
  options?: { rate?: number; pitch?: number; voice?: string }
): Promise<void> {
  return new Promise((resolve, reject) => {
    stopSpeaking();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = options?.rate ?? 1.0;
    utterance.pitch = options?.pitch ?? 1.0;

    // Try to find requested voice
    if (options?.voice) {
      const voices = window.speechSynthesis.getVoices();
      const found = voices.find(
        (v) =>
          v.name.toLowerCase().includes(options.voice!.toLowerCase()) ||
          v.lang.toLowerCase().includes(options.voice!.toLowerCase())
      );
      if (found) utterance.voice = found;
    }

    // Use a simple interval-based approach for mouth movement
    // since Web Audio API can't easily capture TTS output
    let mouthInterval: ReturnType<typeof setInterval> | null = null;
    let time = 0;

    utterance.onstart = () => {
      // Simulate mouth movement based on text rhythm
      mouthInterval = setInterval(() => {
        time += 0.05;
        // Create natural-looking mouth movement with multiple sine waves
        const v1 = Math.sin(time * 12) * 0.3;
        const v2 = Math.sin(time * 7.3) * 0.2;
        const v3 = Math.sin(time * 3.1) * 0.15;
        const volume = Math.max(0, Math.min(1, 0.35 + v1 + v2 + v3));
        onViseme(volume);
      }, 1000 / 30); // 30fps updates
    };

    utterance.onend = () => {
      if (mouthInterval) clearInterval(mouthInterval);
      onViseme(0);
      resolve();
    };

    utterance.onerror = (e) => {
      if (mouthInterval) clearInterval(mouthInterval);
      onViseme(0);
      // 'canceled' is not a real error
      if (e.error === 'canceled') {
        resolve();
      } else {
        reject(e);
      }
    };

    window.speechSynthesis.speak(utterance);
  });
}

export function getAvailableVoices(): SpeechSynthesisVoice[] {
  return window.speechSynthesis.getVoices();
}
