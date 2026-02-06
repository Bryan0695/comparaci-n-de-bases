import React, { useState } from 'react';
import ConnectionForm from './components/ConnectionForm';
import DiffViewer from './components/DiffViewer';
import ErrorBoundary from './components/ErrorBoundary';
import './App.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

function sanitizeUriLabel(uri) {
  try {
    const parsed = new URL(uri);
    // Strip username:password from the URI for display
    parsed.username = '';
    parsed.password = '';
    return parsed.host + parsed.pathname;
  } catch {
    return uri;
  }
}

function App() {
  const [results, setResults] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [uri1, setUri1] = useState('');
  const [uri2, setUri2] = useState('');

  const handleCompare = async (uri1, uri2, prefix1, prefix2, skipCollections) => {
    setLoading(true);
    setError(null);
    setResults(null);
    setWarnings([]);

    try {
      const response = await fetch(`${API_BASE}/api/compare`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uri1, uri2, prefix1, prefix2, skipCollections }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error en la comparación');
      }

      setResults(data.results);
      if (data.warnings) {
        setWarnings(data.warnings);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <h1>MongoDiff: Comparador de Bases</h1>

      <ConnectionForm onCompare={(u1, u2, p1, p2, skip) => {
        setUri1(u1);
        setUri2(u2);
        handleCompare(u1, u2, p1, p2, skip);
      }} isLoading={loading} />

      {error && (
        <div className="card" style={{ borderLeft: '4px solid var(--danger)' }}>
          <h3 style={{ color: 'var(--danger)' }}>Error</h3>
          <p>{error}</p>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="card" style={{ borderLeft: '4px solid #f59e0b' }}>
          <h3 style={{ color: '#f59e0b' }}>Advertencias</h3>
          {warnings.map((w, i) => <p key={i}>{w}</p>)}
        </div>
      )}

      {results && (
        <ErrorBoundary>
          <DiffViewer
            results={results}
            dbLabels={[sanitizeUriLabel(uri1) || 'BD 1', sanitizeUriLabel(uri2) || 'BD 2']}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}

export default App;
