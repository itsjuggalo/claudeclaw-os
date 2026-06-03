import { runAgent } from '/home/itsju/claudeclaw-os/dist/agent.js';
import { parseYamlProvider } from '/home/itsju/claudeclaw-os/dist/provider.js';

const provider = parseYamlProvider('/home/itsju/.claudeclaw/agents/openclaw/agent.yaml');

const result = await runAgent(
  'Reply with exactly: OK',
  undefined,
  () => {},
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  provider,
);

console.log(JSON.stringify({
  hasText: !!result.text,
  text: (result.text || '').slice(0, 200),
  aborted: !!result.aborted,
  hasSession: !!result.newSessionId,
}, null, 2));
