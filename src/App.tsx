import { useState, useRef, useCallback } from 'react';
import AvatarScene from './components/AvatarScene';
import type { AvatarSceneHandle } from './components/AvatarScene';
import ChatPanel from './components/ChatPanel';
import SettingsPanel from './components/SettingsPanel';
import type { ChatMessage, AppSettings, Expression } from './types';
import { sendChat } from './services/llm';
import { speak, stopSpeaking, isSpeaking as checkSpeaking } from './services/tts';

const DEFAULT_SETTINGS: AppSettings = {
  llm: {
    provider: 'lmstudio',
    apiKey: 'lm-studio',
    baseUrl: '/lmstudio/v1',
    model: 'local-model',
  },
  tts: {
    provider: 'browser',
    rate: 1.0,
    pitch: 1.0,
  },
  avatarPath: '/models/avatar_fbx/Meshy_AI_Hot_young_muscular_bi_biped/Meshy_AI_Hot_young_muscular_bi_biped_Character_output.fbx',
  systemPrompt: 'You are a friendly AI assistant with a 3D avatar. Be expressive and conversational.',
};

function loadSettings(): AppSettings {
  try {
    const saved = localStorage.getItem('avatar-chat-settings');
    if (saved) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    }
  } catch {
    // ignore
  }
  return DEFAULT_SETTINGS;
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [currentExpression, setCurrentExpression] = useState<Expression>('neutral');

  const avatarRef = useRef<AvatarSceneHandle>(null);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.vrm') || file.name.endsWith('.glb'))) {
      const url = URL.createObjectURL(file);
      setSettings((s) => ({ ...s, avatarPath: url }));
      setAvatarError(null);
      setAvatarLoaded(false);
    }
  }, []);

  const handleSend = useCallback(
    async (text: string) => {
      const userMessage: ChatMessage = { role: 'user', content: text };
      const newMessages = [...messages, userMessage];
      setMessages(newMessages);
      setIsLoading(true);

      // Stop any current speech
      if (checkSpeaking()) {
        stopSpeaking();
        setIsSpeaking(false);
      }

      try {
        // Build messages including system prompt
        const chatMessages: ChatMessage[] = [
          ...(settings.systemPrompt
            ? [{ role: 'system' as const, content: settings.systemPrompt }]
            : []),
          ...newMessages,
        ];

        const response = await sendChat(chatMessages, settings.llm);

        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: response.text,
          expression: response.expression,
        };

        setMessages((prev) => [...prev, assistantMessage]);
        setIsLoading(false);

        // Set expression on avatar
        setCurrentExpression(response.expression);
        avatarRef.current?.setExpression(response.expression);

        // Speak the response with lip sync
        setIsSpeaking(true);
        await speak(
          response.text,
          (volume) => {
            avatarRef.current?.setMouthOpen(volume);
          },
          {
            rate: settings.tts.rate,
            pitch: settings.tts.pitch,
            voice: settings.tts.voice,
          }
        );
        setIsSpeaking(false);

        // Return to neutral after speaking
        setTimeout(() => {
          avatarRef.current?.setExpression('neutral');
          setCurrentExpression('neutral');
        }, 1000);
      } catch (error) {
        console.error('Chat error:', error);
        const errorMsg =
          error instanceof Error ? error.message : 'Unknown error';
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `Error: ${errorMsg}. Check your LLM settings.`,
          },
        ]);
        setIsLoading(false);
      }
    },
    [messages, settings]
  );

  return (
    <div style={styles.app}>
      {/* Header */}
      <header style={styles.header}>
        <h1 style={styles.title}>AI Avatar Chat</h1>
        <div style={styles.headerRight}>
          <span style={styles.expressionBadge}>{currentExpression}</span>
          <button
            style={styles.settingsBtn}
            onClick={() => setShowSettings(true)}
          >
            Settings
          </button>
        </div>
      </header>

      {/* Main content */}
      <div style={styles.main}>
        {/* Avatar viewport */}
        <div
          style={styles.avatarContainer}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleFileDrop}
        >
          {avatarError ? (
            <div style={styles.errorOverlay}>
              <p style={styles.errorText}>{avatarError}</p>
              <p style={styles.errorHint}>
                Place a .vrm file in <code>public/models/avatar.vrm</code> or
                update the path in Settings.
              </p>
              <button
                style={styles.settingsBtn}
                onClick={() => setShowSettings(true)}
              >
                Open Settings
              </button>
            </div>
          ) : (
            <AvatarScene
              ref={avatarRef}
              avatarUrl={settings.avatarPath}
              onLoaded={() => setAvatarLoaded(true)}
              onError={(err) => setAvatarError(err)}
            />
          )}
          {!avatarLoaded && !avatarError && (
            <div style={styles.loadingOverlay}>Loading avatar...</div>
          )}
        </div>

        {/* Chat panel */}
        <div style={styles.chatContainer}>
          <ChatPanel
            messages={messages}
            onSend={handleSend}
            isLoading={isLoading}
            isSpeaking={isSpeaking}
          />
        </div>
      </div>

      {/* Settings modal */}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          onSave={(s) => {
            setSettings(s);
            setAvatarError(null);
            setAvatarLoaded(false);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: '#0a0a1a',
    color: '#e0e0e0',
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 24px',
    background: '#16213e',
    borderBottom: '1px solid #333366',
  },
  title: {
    margin: 0,
    fontSize: '18px',
    color: '#7b8cde',
    fontWeight: 600,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  expressionBadge: {
    padding: '4px 12px',
    borderRadius: '12px',
    background: '#533483',
    color: '#d4b8ff',
    fontSize: '12px',
    textTransform: 'capitalize' as const,
  },
  settingsBtn: {
    padding: '8px 16px',
    borderRadius: '8px',
    border: '1px solid #333366',
    background: 'transparent',
    color: '#7b8cde',
    cursor: 'pointer',
    fontSize: '13px',
  },
  main: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
    gap: '0',
  },
  avatarContainer: {
    flex: 2,
    position: 'relative',
    minHeight: '400px',
    padding: '12px',
  },
  chatContainer: {
    flex: 1,
    minWidth: '320px',
    maxWidth: '480px',
    padding: '12px 12px 12px 0',
  },
  loadingOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(10, 10, 26, 0.8)',
    color: '#7b8cde',
    fontSize: '16px',
    borderRadius: '12px',
    margin: '12px',
  },
  errorOverlay: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    padding: '40px',
    textAlign: 'center',
    background: '#1a1a2e',
    borderRadius: '12px',
  },
  errorText: {
    color: '#e94560',
    fontSize: '16px',
    marginBottom: '12px',
  },
  errorHint: {
    color: '#888',
    fontSize: '13px',
    marginBottom: '16px',
    lineHeight: '1.6',
  },
};
