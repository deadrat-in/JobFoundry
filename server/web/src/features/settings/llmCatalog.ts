export interface LlmModelRecommendation {
  id: string;
  name: string;
  tier: 'fast' | 'reasoning';
  description: string;
  provider: string;
}

export interface LlmProviderMeta {
  id: string;
  name: string;
  icon?: string;
  defaultBase?: string;
  isLocal?: boolean;
  isCustom?: boolean;
  keyPlaceholder?: string;
  keyHelp?: string;
  recommendedModels: LlmModelRecommendation[];
}

export const LLM_PROVIDERS: LlmProviderMeta[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    keyPlaceholder: 'sk-or-v1-...',
    keyHelp: 'Provides unified multi-model routing across commercial and open-weight models.',
    recommendedModels: [
      {
        id: 'openrouter/free',
        name: 'OpenRouter Free Tier',
        tier: 'fast',
        description: 'Zero-cost high-throughput evaluation',
        provider: 'openrouter',
      },
      {
        id: 'openrouter/auto',
        name: 'OpenRouter Auto Router',
        tier: 'fast',
        description: 'Auto-routes to the best value model',
        provider: 'openrouter',
      },
      {
        id: 'deepseek/deepseek-v4.1-flash',
        name: 'DeepSeek V4.1 Flash',
        tier: 'fast',
        description: 'Ultra-fast sparse MoE (206 tok/s)',
        provider: 'openrouter',
      },
      {
        id: 'anthropic/claude-fable-5.1',
        name: 'Claude Fable 5.1',
        tier: 'reasoning',
        description: 'Top-tier deliberative writing & coding',
        provider: 'openrouter',
      },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    keyPlaceholder: 'sk-...',
    recommendedModels: [
      {
        id: 'gpt-5.6-luna',
        name: 'GPT-5.6 Luna',
        tier: 'fast',
        description: '150 tok/s high-throughput budget workhorse',
        provider: 'openai',
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        tier: 'fast',
        description: 'Fast, cost-effective structured screening',
        provider: 'openai',
      },
      {
        id: 'gpt-6-astra',
        name: 'GPT-6 Astra',
        tier: 'reasoning',
        description: 'Advanced frontier reasoning & multi-step execution',
        provider: 'openai',
      },
      {
        id: 'gpt-5.6-sol',
        name: 'GPT-5.6 Sol',
        tier: 'reasoning',
        description: 'Flagship coding and token-efficient tailoring',
        provider: 'openai',
      },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    keyPlaceholder: 'sk-ant-...',
    recommendedModels: [
      {
        id: 'claude-3-5-haiku-20241022',
        name: 'Claude 3.5 Haiku',
        tier: 'fast',
        description: 'Low latency, fast document extraction',
        provider: 'anthropic',
      },
      {
        id: 'claude-fable-5.1',
        name: 'Claude Fable 5.1',
        tier: 'reasoning',
        description: 'Benchmark leader for nuanced professional writing & ATS tailoring',
        provider: 'anthropic',
      },
      {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        tier: 'reasoning',
        description: 'Exceptional reasoning and structured JSON output',
        provider: 'anthropic',
      },
    ],
  },
  {
    id: 'google',
    name: 'Google Gemini',
    keyPlaceholder: 'AIzaSy...',
    recommendedModels: [
      {
        id: 'gemini/gemini-3.8-flash',
        name: 'Gemini 3.8 Flash',
        tier: 'fast',
        description: 'Near 300 tok/s streaming, 1M context workhorse',
        provider: 'google',
      },
      {
        id: 'gemini/gemini-3.7-flash',
        name: 'Gemini 3.7 Flash',
        tier: 'fast',
        description: 'Low-latency code and agentic screening',
        provider: 'google',
      },
      {
        id: 'gemini/gemini-3.8-flash-thinking',
        name: 'Gemini 3.8 Flash (Thinking)',
        tier: 'reasoning',
        description: 'Deliberative reasoning with test-time compute',
        provider: 'google',
      },
      {
        id: 'gemini/gemma-4-26b-a4b',
        name: 'Gemma 4 26B-A4B',
        tier: 'fast',
        description: 'Efficient 4B active MoE parameter compute',
        provider: 'google',
      },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    keyPlaceholder: 'sk-...',
    recommendedModels: [
      {
        id: 'deepseek/deepseek-v4.1-flash',
        name: 'DeepSeek V4.1 Flash',
        tier: 'fast',
        description: '552B MoE (16B active), 206 tok/s, market-leading caching margins',
        provider: 'deepseek',
      },
      {
        id: 'deepseek/deepseek-chat',
        name: 'DeepSeek V4 Flash / Chat',
        tier: 'fast',
        description: 'Sparse MoE for high-throughput screening',
        provider: 'deepseek',
      },
      {
        id: 'deepseek/deepseek-v4.1-pro',
        name: 'DeepSeek V4.1 Pro',
        tier: 'reasoning',
        description: '2.8T MoE frontier reasoning for deep tailoring',
        provider: 'deepseek',
      },
      {
        id: 'deepseek/deepseek-reasoner',
        name: 'DeepSeek Reasoner (R1)',
        tier: 'reasoning',
        description: 'Deliberative chain-of-thought at budget rates',
        provider: 'deepseek',
      },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    keyPlaceholder: 'gsk_...',
    recommendedModels: [
      {
        id: 'groq/llama-3.3-70b-versatile',
        name: 'Llama 3.3 70B Versatile',
        tier: 'fast',
        description: 'Sub-second LPUs for instantaneous job screening',
        provider: 'groq',
      },
      {
        id: 'groq/llama-3.1-8b-instant',
        name: 'Llama 3.1 8B Instant',
        tier: 'fast',
        description: 'Ultra-low TTFT for rapid bulk classification',
        provider: 'groq',
      },
    ],
  },
  {
    id: 'qwen',
    name: 'Alibaba Qwen',
    keyPlaceholder: 'sk-...',
    recommendedModels: [
      {
        id: 'qwen/qwen-3.8-flash',
        name: 'Qwen 3.8 Flash',
        tier: 'fast',
        description: 'Hybrid Gated DeltaNet attention, 1M context, sub-dollar economics',
        provider: 'qwen',
      },
      {
        id: 'qwen/qwen-3.8-max',
        name: 'Qwen 3.8 Max',
        tier: 'reasoning',
        description: '2.4T multimodal flagship for deep synthesis',
        provider: 'qwen',
      },
    ],
  },
  {
    id: 'zhipu',
    name: 'Zhipu AI (Z.ai)',
    keyPlaceholder: '...',
    recommendedModels: [
      {
        id: 'zhipu/glm-5.3-flash',
        name: 'GLM-5.3 Flash',
        tier: 'fast',
        description: '320B MoE (18B active) high-speed bilingual workhorse',
        provider: 'zhipu',
      },
      {
        id: 'zhipu/glm-5.3',
        name: 'GLM-5.3 Thinking',
        tier: 'reasoning',
        description: '743B MoE agentic reasoning engine',
        provider: 'zhipu',
      },
      {
        id: 'zhipu/glm-5.2',
        name: 'GLM-5.2 Open Weights',
        tier: 'reasoning',
        description: 'Top-tier open-weights long-horizon reasoning',
        provider: 'zhipu',
      },
    ],
  },
  {
    id: 'moonshot',
    name: 'Moonshot AI',
    keyPlaceholder: 'sk-...',
    recommendedModels: [
      {
        id: 'moonshot/kimi-k3',
        name: 'Kimi K3',
        tier: 'reasoning',
        description: '2.8T MoE open-weights SOTA reasoning engine',
        provider: 'moonshot',
      },
    ],
  },
  {
    id: 'meta',
    name: 'Meta Superintelligence',
    keyPlaceholder: '...',
    recommendedModels: [
      {
        id: 'meta/muse-spark-1.3',
        name: 'Muse Spark 1.3',
        tier: 'reasoning',
        description: 'Thought compression, long-horizon agentic task completion',
        provider: 'meta',
      },
    ],
  },
  {
    id: 'ibm',
    name: 'IBM Granite',
    keyPlaceholder: '...',
    recommendedModels: [
      {
        id: 'ibm/granite-4.1-8b',
        name: 'Granite 4.1 8B',
        tier: 'fast',
        description: 'Dense 8B architecture, Apache 2.0, zero-inflation enterprise RAG',
        provider: 'ibm',
      },
    ],
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    keyPlaceholder: '...',
    recommendedModels: [
      {
        id: 'mistral/leanstral-1.5',
        name: 'Leanstral 1.5',
        tier: 'fast',
        description: '119B MoE (6B active), formal deductive precision',
        provider: 'mistral',
      },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    isLocal: true,
    defaultBase: 'http://localhost:11434',
    keyPlaceholder: 'optional (local)',
    keyHelp: 'Runs locally on your device with 0 external API calls and complete privacy.',
    recommendedModels: [
      {
        id: 'ollama/llama3.2',
        name: 'Llama 3.2 (Local)',
        tier: 'fast',
        description: 'Compact, fast local scoring model',
        provider: 'ollama',
      },
      {
        id: 'ollama/granite4.1-8b',
        name: 'Granite 4.1 8B (Local)',
        tier: 'fast',
        description: 'Dense Apache 2.0 local model with low VRAM footprint',
        provider: 'ollama',
      },
      {
        id: 'ollama/llama3.3:70b',
        name: 'Llama 3.3 70B (Local)',
        tier: 'reasoning',
        description: 'Frontier-grade local resume tailoring',
        provider: 'ollama',
      },
    ],
  },
  {
    id: 'custom',
    name: 'Custom / Self-Hosted Gateway',
    isCustom: true,
    defaultBase: 'http://localhost:8000/v1',
    keyPlaceholder: 'Bearer token / API key',
    keyHelp: 'Any OpenAI-compatible proxy, vLLM, LM Studio, or private gateway.',
    recommendedModels: [],
  },
];

export function detectProviderFromModel(modelString: string): string {
  const s = (modelString || '').toLowerCase().trim();
  if (s.startsWith('openrouter/')) return 'openrouter';
  if (s.startsWith('groq/')) return 'groq';
  if (s.startsWith('ollama/')) return 'ollama';
  if (s.startsWith('deepseek/')) return 'deepseek';
  if (s.startsWith('gemini/') || s.startsWith('google/')) return 'google';
  if (s.startsWith('anthropic/') || s.includes('claude') || s.includes('fable')) return 'anthropic';
  if (s.startsWith('qwen/') || s.includes('qwen')) return 'qwen';
  if (s.startsWith('zhipu/') || s.includes('glm')) return 'zhipu';
  if (s.startsWith('moonshot/') || s.includes('kimi')) return 'moonshot';
  if (s.startsWith('meta/') || s.includes('muse')) return 'meta';
  if (s.startsWith('ibm/') || s.includes('granite')) return 'ibm';
  if (s.startsWith('mistral/') || s.includes('leanstral')) return 'mistral';
  if (s.startsWith('gpt-') || s.startsWith('openai/') || s.startsWith('o3-')) return 'openai';
  return 'openrouter';
}

export const ALL_RECOMMENDED_MODELS: LlmModelRecommendation[] = Array.from(
  new Map(LLM_PROVIDERS.flatMap((p) => p.recommendedModels).map((m) => [m.id, m])).values()
);
