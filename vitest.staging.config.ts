import { defineConfig } from 'vitest/config';

// The staging security test: real logins against the staging copy, so it
// only runs on purpose (npm run test:staging), never with the unit tests.
export default defineConfig({
  test: {
    include: ['staging/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
