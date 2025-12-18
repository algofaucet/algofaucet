// Polyfill global
if (typeof window !== 'undefined' && !window.global) {
  window.global = window;
}

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/App.css'
import './styles/custom.css'
import ErrorBoundary from './components/ErrorBoundary'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
