import React, { useState, useRef } from 'react';
import ConnectionForm from './components/ConnectionForm';
import DiffViewer from './components/DiffViewer';
import JsonCompareForm from './components/JsonCompareForm';
import JsonDiffViewer from './components/JsonDiffViewer';
import ErrorBoundary from './components/ErrorBoundary';
import './App.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

function sanitizeUriLabel(uri) {
  try {
    const parsed = new URL(uri);
    parsed.username = '';
    parsed.password = '';
    return parsed.host + parsed.pathname;
  } catch {
    return uri;
  }
}

function App() {
  const [mode, setMode] = useState('mongo'); // 'mongo' | 'json'

  // MongoDB mode state
  const [results, setResults] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastSubmit, setLastSubmit] = useState({ uri1: '', uri2: '', name1: '', name2: '' });
  const abortRef = useRef(null);

  // JSON mode state
  const [jsonResult, setJsonResult] = useState(null);

  const handleCompare = async (uri1, uri2, prefix1, prefix2, skipCollections, name1 = '', name2 = '') => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);
    setResults(null);
    setWarnings([]);
    setLastSubmit({ uri1, uri2, name1, name2 });

    try {
      const response = await fetch(`${API_BASE}/api/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uri1, uri2, prefix1, prefix2, skipCollections }),
        signal: abortRef.current.signal,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error en la comparación');
      }

      setResults(data.results);
      if (data.warnings) setWarnings(data.warnings);
    } catch (err) {
      if (err.name === 'AbortError') return;
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleJsonCompare = (json1, json2) => {
    setJsonResult({ json1, json2 });
  };

  const handleModeChange = (newMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    setResults(null);
    setError(null);
    setWarnings([]);
    setJsonResult(null);
    if (abortRef.current) abortRef.current.abort();
  };

  return (
    <div className="container">
      <h1>MongoDiff: Comparador de Bases</h1>

      <div className="mode-tabs">
        <button
          className={`tab-btn${mode === 'mongo' ? ' tab-btn--active' : ''}`}
          onClick={() => handleModeChange('mongo')}
        >
          MongoDB URIs
        </button>
        <button
          className={`tab-btn${mode === 'json' ? ' tab-btn--active' : ''}`}
          onClick={() => handleModeChange('json')}
        >
          JSON
        </button>
      </div>

      {mode === 'mongo' && (
        <>
          <ConnectionForm onCompare={handleCompare} isLoading={loading} />

          {loading && (
            <div className="card loading-card">
              <div className="loading-spinner" />
              <p>Comparando bases de datos...</p>
            </div>
          )}

          {error && (
            <div className="card card--danger">
              <h3>Error</h3>
              <p>{error}</p>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="card card--warning">
              <h3>Advertencias</h3>
              {warnings.map((w, i) => <p key={i}>{w}</p>)}
            </div>
          )}

          {results && (
            <ErrorBoundary>
              <DiffViewer
                results={results}
                dbLabels={[
                  lastSubmit.name1 || sanitizeUriLabel(lastSubmit.uri1) || 'BD 1',
                  lastSubmit.name2 || sanitizeUriLabel(lastSubmit.uri2) || 'BD 2',
                ]}
              />
            </ErrorBoundary>
          )}
        </>
      )}

      {mode === 'json' && (
        <>
          <JsonCompareForm onCompare={handleJsonCompare} />
          {jsonResult && (
            <ErrorBoundary>
              <JsonDiffViewer json1={jsonResult.json1} json2={jsonResult.json2} />
            </ErrorBoundary>
          )}
        </>
      )}
    </div>
  );
}

export default App;
