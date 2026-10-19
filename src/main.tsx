import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './amplify'; // decides sample data vs. the AWS backend; must come first
import { BACKEND } from './amplify';
import App from './App';
import '@fontsource-variable/bricolage-grotesque/wght.css';
import './styles.css';
import { registerServiceWorker } from './push';

// The real site registers the small service worker that shows alerts and
// lets phones install the board as an app. The preview has no server for it.
if (BACKEND === 'aws') registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
