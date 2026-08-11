import React from 'react';
import ReactDOM from 'react-dom/client';
// Poppins UI font, bundled locally (offline-safe) via @fontsource — latin subset,
// the weights the UI uses (400 body, 500/600 buttons+headings, 700 badges/totals).
import '@fontsource/poppins/latin-400.css';
import '@fontsource/poppins/latin-500.css';
import '@fontsource/poppins/latin-600.css';
import '@fontsource/poppins/latin-700.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
