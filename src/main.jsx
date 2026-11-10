import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import '@fontsource-variable/jost/wght.css';
import './styles.css';
import './identity.css';
import './workspace.css';
import './controls.css';
import { revealScrollbarsWhileScrolling } from './scrollbars.js';

revealScrollbarsWhileScrolling();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
