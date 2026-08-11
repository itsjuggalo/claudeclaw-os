import { describe, expect, it } from 'vitest';

import { ratesForOpenAiModel } from './openai-pricing.js';

describe('OpenAI model pricing', () => {
  it.each([
    ['gpt-5.6-sol', 5, 0.5, 30],
    ['gpt-5.6-terra', 2.5, 0.25, 15],
    ['gpt-5.6-luna', 1, 0.1, 6],
  ])('uses published rates for %s', (model, inputPerM, cachedInputPerM, outputPerM) => {
    expect(ratesForOpenAiModel(model)).toEqual({ inputPerM, cachedInputPerM, outputPerM });
  });
});
