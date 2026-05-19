import type { ProviderConfig } from '../provider.js';
import { AcpEngineAdapter } from './acp-adapter.js';
import { ClaudeSdkEngineAdapter } from './claude-sdk-adapter.js';
import type { AgentEngine } from './types.js';

export * from './types.js';
export { AcpEngineAdapter, getAcpCommand } from './acp-adapter.js';
export { ClaudeSdkEngineAdapter } from './claude-sdk-adapter.js';

export class EngineFactory {
  static forProvider(provider: ProviderConfig): AgentEngine {
    if (provider.type === 'claude') return new ClaudeSdkEngineAdapter();
    return new AcpEngineAdapter();
  }
}

