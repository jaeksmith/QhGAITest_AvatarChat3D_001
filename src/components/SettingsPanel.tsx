import { useState, useEffect } from 'react';
import type { AppSettings, LLMConfig, TTSConfig } from '../types';
import { getAvailableVoices } from '../services/tts';

const TEST_PHRASE = 'Hello! I am your AI avatar assistant. How do I sound?';

function previewVoice(voiceName: string, rate: number, pitch: number) {
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(TEST_PHRASE);
  utterance.rate = rate;
  utterance.pitch = pitch;
  if (voiceName) {
    const voices = window.speechSynthesis.getVoices();
    const found = voices.find((v) => v.name === voiceName);
    if (found) utterance.voice = found;
  }
  window.speechSynthesis.speak(utterance);
}

interface SettingsPanelProps {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
}

const PROVIDER_DEFAULTS: Record<string, Partial<LLMConfig>> = {
  lmstudio: {
    baseUrl: '/lmstudio/v1',
    apiKey: 'lm-studio',
    model: 'local-model',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: '',
    model: 'claude-sonnet-4-20250514',
  },
};

export default function SettingsPanel({ settings, onSave, onClose }: SettingsPanelProps) {
  const [local, setLocal] = useState<AppSettings>({ ...settings });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    const loadVoices = () => setVoices(getAvailableVoices());
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  const updateLLM = (patch: Partial<LLMConfig>) => {
    setLocal((s) => ({ ...s, llm: { ...s.llm, ...patch } }));
  };

  const updateTTS = (patch: Partial<TTSConfig>) => {
    setLocal((s) => ({ ...s, tts: { ...s.tts, ...patch } }));
  };

  const handleProviderChange = (provider: string) => {
    const defaults = PROVIDER_DEFAULTS[provider] || {};
    updateLLM({ provider: provider as LLMConfig['provider'], ...defaults });
  };

  const handleSave = () => {
    localStorage.setItem('avatar-chat-settings', JSON.stringify(local));
    onSave(local);
    onClose();
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <h2 style={styles.title}>Settings</h2>

        {/* LLM Settings */}
        <section style={styles.section}>
          <h3 style={styles.sectionTitle}>LLM Provider</h3>

          <label style={styles.label}>Provider</label>
          <select
            style={styles.select}
            value={local.llm.provider}
            onChange={(e) => handleProviderChange(e.target.value)}
          >
            <option value="lmstudio">LM Studio (Local)</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>

          <label style={styles.label}>API Base URL</label>
          <input
            style={styles.input}
            value={local.llm.baseUrl}
            onChange={(e) => updateLLM({ baseUrl: e.target.value })}
          />

          <label style={styles.label}>API Key</label>
          <input
            style={styles.input}
            type="password"
            value={local.llm.apiKey}
            onChange={(e) => updateLLM({ apiKey: e.target.value })}
            placeholder={local.llm.provider === 'lmstudio' ? 'Not required' : 'Enter API key'}
          />

          <label style={styles.label}>Model</label>
          <input
            style={styles.input}
            value={local.llm.model}
            onChange={(e) => updateLLM({ model: e.target.value })}
          />
        </section>

        {/* TTS Settings */}
        <section style={styles.section}>
          <h3 style={styles.sectionTitle}>Text-to-Speech</h3>

          <label style={styles.label}>Voice</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <select
              style={{ ...styles.select, flex: 1 }}
              value={local.tts.voice || ''}
              onChange={(e) => {
                updateTTS({ voice: e.target.value });
                previewVoice(e.target.value, local.tts.rate ?? 1.0, local.tts.pitch ?? 1.0);
              }}
            >
              <option value="">Default</option>
              {voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
            <button
              style={styles.testBtn}
              onClick={() => previewVoice(local.tts.voice || '', local.tts.rate ?? 1.0, local.tts.pitch ?? 1.0)}
            >
              Test
            </button>
          </div>

          <label style={styles.label}>Speed: {local.tts.rate ?? 1.0}x</label>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={local.tts.rate ?? 1.0}
            onChange={(e) => updateTTS({ rate: parseFloat(e.target.value) })}
            style={{ width: '100%' }}
          />

          <label style={styles.label}>Pitch: {local.tts.pitch ?? 1.0}</label>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={local.tts.pitch ?? 1.0}
            onChange={(e) => updateTTS({ pitch: parseFloat(e.target.value) })}
            style={{ width: '100%' }}
          />
        </section>

        {/* Avatar Settings */}
        <section style={styles.section}>
          <h3 style={styles.sectionTitle}>Avatar</h3>
          <label style={styles.label}>VRM File URL / Path</label>
          <input
            style={styles.input}
            value={local.avatarPath}
            onChange={(e) => setLocal((s) => ({ ...s, avatarPath: e.target.value }))}
            placeholder="/models/avatar.vrm"
          />
          <p style={styles.hint}>
            Place a .vrm file in the public/models/ folder, or provide a URL.
            VRChat avatars can be converted to VRM using UniVRM in Unity.
          </p>
        </section>

        {/* System Prompt */}
        <section style={styles.section}>
          <h3 style={styles.sectionTitle}>System Prompt</h3>
          <textarea
            style={{ ...styles.input, minHeight: '80px', resize: 'vertical' }}
            value={local.systemPrompt}
            onChange={(e) => setLocal((s) => ({ ...s, systemPrompt: e.target.value }))}
            placeholder="You are a helpful AI assistant..."
          />
        </section>

        <div style={styles.buttons}>
          <button style={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button style={styles.saveBtn} onClick={handleSave}>
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  panel: {
    background: '#16213e',
    borderRadius: '16px',
    padding: '24px',
    width: '480px',
    maxHeight: '80vh',
    overflowY: 'auto',
    color: '#e0e0e0',
    border: '1px solid #333366',
  },
  title: {
    margin: '0 0 20px',
    fontSize: '20px',
    color: '#7b8cde',
  },
  section: {
    marginBottom: '20px',
    padding: '16px',
    background: '#1a1a3e',
    borderRadius: '10px',
  },
  sectionTitle: {
    margin: '0 0 12px',
    fontSize: '15px',
    color: '#a78bfa',
  },
  label: {
    display: 'block',
    fontSize: '12px',
    color: '#888',
    marginBottom: '4px',
    marginTop: '10px',
  },
  input: {
    width: '100%',
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #333366',
    background: '#0f0f2e',
    color: '#e0e0e0',
    fontSize: '13px',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  },
  select: {
    width: '100%',
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #333366',
    background: '#0f0f2e',
    color: '#e0e0e0',
    fontSize: '13px',
    outline: 'none',
  },
  hint: {
    fontSize: '11px',
    color: '#666',
    marginTop: '6px',
    lineHeight: '1.4',
  },
  buttons: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'flex-end',
    marginTop: '20px',
  },
  cancelBtn: {
    padding: '10px 20px',
    borderRadius: '8px',
    border: '1px solid #333366',
    background: 'transparent',
    color: '#888',
    cursor: 'pointer',
    fontSize: '14px',
  },
  testBtn: {
    padding: '8px 14px',
    borderRadius: '6px',
    border: '1px solid #533483',
    background: '#533483',
    color: '#e0e0e0',
    cursor: 'pointer',
    fontSize: '12px',
    whiteSpace: 'nowrap' as const,
  },
  saveBtn: {
    padding: '10px 20px',
    borderRadius: '8px',
    border: 'none',
    background: '#533483',
    color: '#e0e0e0',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 'bold',
  },
};
