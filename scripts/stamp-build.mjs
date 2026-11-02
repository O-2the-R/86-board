// Runs after the frontend build on Amplify. Publishes two small files next to
// the page:
//   version.json         which commit and branch this build came from, so the
//                        staging test knows when its commit is live
//   amplify_outputs.json the backend's public settings (the same values the
//                        page already carries inside it), so the staging test
//                        can sign in and reach the API
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';

const commit = process.env.AWS_COMMIT_ID ?? 'local';
const branch = process.env.AWS_BRANCH ?? 'local';
writeFileSync('dist/version.json', JSON.stringify({ commit, branch, builtAt: new Date().toISOString() }));
if (existsSync('amplify_outputs.json')) copyFileSync('amplify_outputs.json', 'dist/amplify_outputs.json');
console.log(`Stamped ${branch} @ ${commit}`);
