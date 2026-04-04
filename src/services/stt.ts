type STTCallback = (text: string, isFinal: boolean) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let recognition: any = null;

export function isSTTSupported(): boolean {
  return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
}

export function startListening(onResult: STTCallback, onEnd?: () => void): void {
  if (!isSTTSupported()) {
    console.error('Speech recognition not supported in this browser');
    return;
  }

  stopListening();

  const SpeechRecognitionAPI =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

  recognition = new SpeechRecognitionAPI();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recognition.onresult = (event: any) => {
    let transcript = '';
    let isFinal = false;

    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        isFinal = true;
      }
    }

    onResult(transcript, isFinal);
  };

  recognition.onend = () => {
    recognition = null;
    onEnd?.();
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recognition.onerror = (event: any) => {
    console.error('Speech recognition error:', event.error);
    recognition = null;
    onEnd?.();
  };

  recognition.start();
}

export function stopListening(): void {
  if (recognition) {
    recognition.stop();
    recognition = null;
  }
}

export function isListening(): boolean {
  return recognition !== null;
}
