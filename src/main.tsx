import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './amplify'; // decides sample data vs. the AWS backend; must come first
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
