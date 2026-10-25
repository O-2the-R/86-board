import { defineConfig } from 'vitest/config';

// Plain unit tests: the Lambda rules, the report's day boundaries, the item
// transitions, the sample data. Nothing here needs AWS or a browser.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'shared/**/*.test.ts', 'amplify/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '.amplify'],
    environment: 'node',
  },
});
