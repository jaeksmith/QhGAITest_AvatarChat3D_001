import { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '../types';
import { startListening, stopListening, isSTTSupported } from '../services/stt';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  isLoading: boolean;
  isSpeaking: boolean;
}

export default function ChatPanel({ messages, onSend, isLoading, isSpeaking }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [interimText, setInterimText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    onSend(text);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleVoice = () => {
    if (isRecording) {
      stopListening();
      setIsRecording(false);
      setInterimText('');
    } else {
      setIsRecording(true);
      startListening(
        (text, isFinal) => {
          if (isFinal) {
            setIsRecording(false);
            setInterimText('');
            onSend(text);
          } else {
            setInterimText(text);
          }
        },
        () => {
          setIsRecording(false);
          setInterimText('');
        }
      );
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.messages}>
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              ...styles.message,
              ...(msg.role === 'user' ? styles.userMessage : styles.assistantMessage),
            }}
          >
            <div style={styles.messageRole}>
              {msg.role === 'user' ? 'You' : 'Avatar'}
            </div>
            <div style={styles.messageContent}>{msg.content}</div>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {msg.expression && (
                <span style={styles.expressionTag}>{msg.expression}</span>
              )}
              {msg.animations?.map((anim, j) => (
                <span key={j} style={styles.animTag}>{anim}</span>
              ))}
            </div>
          </div>
        ))}
        {isLoading && (
          <div style={{ ...styles.message, ...styles.assistantMessage }}>
            <div style={styles.messageRole}>Avatar</div>
            <div style={styles.typing}>Thinking...</div>
          </div>
        )}
        {isSpeaking && (
          <div style={styles.speakingIndicator}>Speaking...</div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div style={styles.inputArea}>
        {interimText && (
          <div style={styles.interimText}>{interimText}</div>
        )}
        <div style={styles.inputRow}>
          <textarea
            style={styles.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            disabled={isLoading}
          />
          {isSTTSupported() && (
            <button
              style={{
                ...styles.voiceBtn,
                ...(isRecording ? styles.voiceBtnActive : {}),
              }}
              onClick={toggleVoice}
              disabled={isLoading}
              title="Voice input"
            >
              {isRecording ? '⏹' : '🎤'}
            </button>
          )}
          <button
            style={styles.sendBtn}
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#16213e',
    borderRadius: '12px',
    overflow: 'hidden',
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  message: {
    padding: '10px 14px',
    borderRadius: '10px',
    maxWidth: '85%',
    wordWrap: 'break-word',
  },
  userMessage: {
    alignSelf: 'flex-end',
    background: '#0f3460',
    color: '#e0e0e0',
  },
  assistantMessage: {
    alignSelf: 'flex-start',
    background: '#1a1a3e',
    color: '#e0e0e0',
    border: '1px solid #333366',
  },
  messageRole: {
    fontSize: '11px',
    fontWeight: 'bold',
    color: '#7b8cde',
    marginBottom: '4px',
    textTransform: 'uppercase' as const,
  },
  messageContent: {
    fontSize: '14px',
    lineHeight: '1.5',
  },
  expressionTag: {
    display: 'inline-block',
    marginTop: '6px',
    padding: '2px 8px',
    fontSize: '11px',
    borderRadius: '12px',
    background: '#533483',
    color: '#d4b8ff',
  },
  animTag: {
    display: 'inline-block',
    marginTop: '6px',
    padding: '2px 8px',
    fontSize: '11px',
    borderRadius: '12px',
    background: '#0f3460',
    color: '#7bb8de',
  },
  typing: {
    color: '#888',
    fontStyle: 'italic',
  },
  speakingIndicator: {
    textAlign: 'center',
    color: '#7b8cde',
    fontSize: '12px',
    padding: '4px',
  },
  inputArea: {
    padding: '12px',
    borderTop: '1px solid #333366',
  },
  interimText: {
    padding: '6px 12px',
    marginBottom: '8px',
    fontSize: '13px',
    color: '#aaa',
    fontStyle: 'italic',
    background: '#1a1a3e',
    borderRadius: '6px',
  },
  inputRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    padding: '10px 14px',
    borderRadius: '8px',
    border: '1px solid #333366',
    background: '#0f0f2e',
    color: '#e0e0e0',
    fontSize: '14px',
    resize: 'none',
    outline: 'none',
    fontFamily: 'inherit',
  },
  voiceBtn: {
    padding: '10px 14px',
    borderRadius: '8px',
    border: 'none',
    background: '#333366',
    color: '#e0e0e0',
    cursor: 'pointer',
    fontSize: '16px',
  },
  voiceBtnActive: {
    background: '#e94560',
    animation: 'pulse 1s infinite',
  },
  sendBtn: {
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
