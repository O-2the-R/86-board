// What the app needs to know about the AI model it is set to use
// (ASK_MODEL_ID). The id is Amazon Bedrock's, with the route in front:
// "us.anthropic.claude-haiku-4-5-20251001-v1:0".

const ROUTE = /^(us|eu|apac|jp|au|ca|in|us-gov|global)\./;

// The name people know it by ("Claude Haiku 4.5"), for the owner's screen.
// An id this does not recognise is shown as it is.
export function modelLabel(modelId: string): string {
  const bare = modelId.replace(ROUTE, '').replace(/^[a-z0-9-]+\./, '');
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|$)/.exec(bare);
  if (!m) return modelId;
  const family = m[1][0].toUpperCase() + m[1].slice(1);
  return `Claude ${family} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
}

// Claude 5 models think before they answer unless told not to. Earlier
// ones, and other makers' models, think only when asked to.
export function thinksByDefault(modelId: string): boolean {
  const m = /claude-[a-z]+-(\d+)(?:-|$)/.exec(modelId);
  return m !== null && Number(m[1]) >= 5;
}
