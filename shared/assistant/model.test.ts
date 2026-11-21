import { describe, expect, it } from 'vitest';
import { modelLabel, thinksByDefault } from './model';

describe('the AI model the app is set to use', () => {
  it('is shown to the owner by the name people know', () => {
    expect(modelLabel('us.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe('Claude Haiku 4.5');
    expect(modelLabel('us.anthropic.claude-haiku-5-5')).toBe('Claude Haiku 5.5');
    expect(modelLabel('global.anthropic.claude-opus-5')).toBe('Claude Opus 5');
    expect(modelLabel('eu.anthropic.claude-sonnet-4-20250514-v1:0')).toBe('Claude Sonnet 4');
    expect(modelLabel('anthropic.claude-haiku-4-5-20251001-v1:0')).toBe('Claude Haiku 4.5');
  });

  it('is shown as it is when the id is not one it knows', () => {
    expect(modelLabel('us.amazon.nova-lite-v1:0')).toBe('us.amazon.nova-lite-v1:0');
    expect(modelLabel('')).toBe('');
  });

  it('knows which models think unless told not to', () => {
    expect(thinksByDefault('us.anthropic.claude-haiku-5-5')).toBe(true);
    expect(thinksByDefault('global.anthropic.claude-opus-5')).toBe(true);
    expect(thinksByDefault('us.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe(false);
    expect(thinksByDefault('us.anthropic.claude-3-5-haiku-20241022-v1:0')).toBe(false);
    expect(thinksByDefault('us.amazon.nova-lite-v1:0')).toBe(false);
    expect(thinksByDefault('')).toBe(false);
  });
});
