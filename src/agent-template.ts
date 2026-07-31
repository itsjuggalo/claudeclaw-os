import yaml from 'js-yaml';

import { providerToYaml, type ProviderConfig } from './provider.js';

/**
 * Replace only the active provider block in an agent.yaml template.
 *
 * Keeping this as a text-level replacement preserves the surrounding comments
 * and optional configuration examples. The persona stays provider-neutral;
 * setup supplies the explicit provider configuration in agent.yaml.
 */
export function applyProviderToAgentYamlTemplate(
  template: string,
  provider: ProviderConfig,
): string {
  const providerBlock = yaml.dump(
    { provider: providerToYaml(provider) },
    { lineWidth: -1 },
  ).trimEnd();
  const activeProviderBlock = /^provider:\s*\r?\n(?:[ \t]+.*(?:\r?\n|$))*/m;

  if (!activeProviderBlock.test(template)) {
    throw new Error('agent.yaml template has no active provider block');
  }

  return template.replace(activeProviderBlock, `${providerBlock}\n`);
}
