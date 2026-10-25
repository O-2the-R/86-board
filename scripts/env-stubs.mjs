// Amplify writes .amplify/generated/env/<function>.ts during a deploy or a
// sandbox. Outside those (laptop, CI) the files do not exist, so the backend
// cannot be type-checked. This writes a stand-in for every function that has
// none yet. Real generated files are never overwritten.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const fnDir = join(root, 'amplify', 'functions');
const outDir = join(root, '.amplify', 'generated', 'env');
mkdirSync(outDir, { recursive: true });

const stub = `// Stand-in for the file Amplify generates at deploy time (scripts/env-stubs.mjs).
export const env: {
  AMPLIFY_AUTH_USERPOOL_ID: string;
  AMPLIFY_DATA_GRAPHQL_ENDPOINT: string;
  AMPLIFY_DATA_DEFAULT_NAME: string;
  AMPLIFY_DATA_MODEL_INTROSPECTION_SCHEMA_BUCKET_NAME: string;
  AMPLIFY_DATA_MODEL_INTROSPECTION_SCHEMA_KEY: string;
  AWS_REGION: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_SESSION_TOKEN: string;
  [key: string]: string;
} = process.env as never;
`;

for (const dir of readdirSync(fnDir, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const resource = join(fnDir, dir.name, 'resource.ts');
  if (!existsSync(resource)) continue;
  const name = /name:\s*['"]([^'"]+)['"]/.exec(readFileSync(resource, 'utf8'))?.[1] ?? dir.name;
  const target = join(outDir, `${name}.ts`);
  if (existsSync(target)) continue;
  writeFileSync(target, stub);
  console.log(`env stub written for ${name}`);
}
