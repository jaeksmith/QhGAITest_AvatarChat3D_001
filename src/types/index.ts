export interface AnimationCue {
  token: string;
  atIndex: number; // character index in the text where this animation should trigger
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  expression?: string;
  animations?: string[];
}

export interface LLMConfig {
  provider: 'openai' | 'lmstudio' | 'anthropic';
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface TTSConfig {
  provider: 'browser' | 'openai';
  apiKey?: string;
  voice?: string;
  rate?: number;
  pitch?: number;
}

export interface AppSettings {
  llm: LLMConfig;
  tts: TTSConfig;
  avatarPath: string;
  systemPrompt: string;
}

export type Expression = 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' | 'relaxed';

export const EXPRESSIONS: Expression[] = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'relaxed'];

export interface LLMResponse {
  text: string;
  expression: Expression;
  animations: string[]; // animation tokens to play in sequence
}
