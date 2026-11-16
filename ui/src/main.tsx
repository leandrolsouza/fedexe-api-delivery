import { isTauri } from '@tauri-apps/api/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

if (isTauri()) {
  document.addEventListener('contextmenu', (event) => {
    // Let the app's context menus run first and keep the WebView's text-editing actions.
    if (event.defaultPrevented) return;

    const target = event.target;
    const isTextEditor =
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.matches(
          'textarea:enabled, input:enabled:is([type="text"], [type="search"], [type="url"], [type="email"], [type="tel"], [type="password"], [type="number"], :not([type]))',
        ));

    if (!isTextEditor) event.preventDefault();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
