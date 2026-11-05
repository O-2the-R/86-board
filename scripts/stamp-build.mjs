// Runs after the frontend build on Amplify. Publishes two small files next to
// the page:
//   version.json         which commit and branch this build came from, so the
//                        staging test knows when its commit is live
//   amplify_outputs.json the backend's public settings (the same values the
//                        page already carries inside it), so the staging test
//                        can sign in and reach the API
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';

// Amplify sets AWS_COMMIT_ID to "HEAD" on builds it starts itself (a new
// branch, a redeploy), so ask git for the real commit when it is not one.
function commitId() {
  const fromAmplify = process.env.AWS_COMMIT_ID ?? '';
  if (/^[0-9a-f]{40}$/.test(fromAmplify)) return fromAmplify;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return fromAmplify || 'local';
  }
}

const commit = commitId();
const branch = process.env.AWS_BRANCH ?? 'local';
writeFileSync('dist/version.json', JSON.stringify({ commit, branch, builtAt: new Date().toISOString() }));
if (existsSync('amplify_outputs.json')) copyFileSync('amplify_outputs.json', 'dist/amplify_outputs.json');
console.log(`Stamped ${branch} @ ${commit}`);
