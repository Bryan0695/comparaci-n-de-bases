import React, { useEffect, useRef, useState } from 'react';
import { format as formatHtml } from 'jsondiffpatch/formatters/html';
import DOMPurify from 'dompurify';
import '../jsondiffpatch.css';

function DiffItem({ id, diff, status }) {
    const containerRef = useRef(null);

    useEffect(() => {
        if (containerRef.current && diff) {
            const rawHtml = formatHtml(diff, undefined);
            containerRef.current.innerHTML = DOMPurify.sanitize(rawHtml);
        }
    }, [diff]);

    return (
        <div className="diff-item">
            <h4>Documento ID: {id} <span className="collection-status status-different">{status}</span></h4>
            {diff ? <div ref={containerRef} /> : <p>Documento faltante.</p>}
        </div>
    );
}

function CollectionView({ name, data, dbLabels }) {
    const [expanded, setExpanded] = useState(false);

    // If missing collection
    if (data.status === 'missing_collection') {
        const missingIn = data.summary.inDb1 ? dbLabels[1] : dbLabels[0];
        return (
            <div className="card" style={{ borderLeft: '4px solid var(--danger)' }}>
                <div className="collection-header">
                    <h3>Colección: {name}</h3>
                    <span className="collection-status status-different">Falta en {missingIn}</span>
                </div>
            </div>
        );
    }

    return (
        <div className="card">
            <div className="collection-header" onClick={() => setExpanded(!expanded)}>
                <h3>Colección: {name}</h3>
                <div>
                    <span className={`collection-status status-${data.status}`} style={{ marginRight: '10px' }}>
                        {data.status === 'equal' ? 'Iguales' : 'Diferentes'}
                    </span>
                    <small>{expanded ? '▼' : '▶'}</small>
                </div>
            </div>

            {expanded && (
                <div className="collection-details">
                    <div className="collection-summary">
                        <p>Docs en {dbLabels[0]}: {data.summary.count1} | Docs en {dbLabels[1]}: {data.summary.count2}</p>
                        {data.summary.truncated && (
                            <p style={{ color: '#f59e0b', fontSize: '0.85rem' }}>
                                Resultados truncados: la colección excede el límite máximo de documentos comparables.
                            </p>
                        )}
                    </div>

                    {data.diffs && data.diffs.length > 0 && (
                        <div className="diff-list">
                            {data.diffs.map((d) => (
                                <DiffItem key={d.id} id={d.id} diff={d.diff} status={d.status} />
                            ))}
                        </div>
                    )}

                    {data.status === 'equal' && (
                        <p style={{ color: 'var(--success)' }}>Todo el contenido coincide perfectamente.</p>
                    )}
                </div>
            )}
        </div>
    );
}

function DatabaseView({ name, data, dbLabels }) {
    const [expanded, setExpanded] = useState(true);

    if (data.status === 'missing_database') {
        return (
            <div className="card" style={{ border: '1px solid var(--danger)' }}>
                <h3>Base de Datos: {name} - <span style={{ color: 'var(--danger)' }}>NO EXISTE EN AMBAS</span></h3>
            </div>
        );
    }

    return (
        <div style={{ marginBottom: '2rem' }}>
            <div
                className="card"
                style={{ background: 'var(--bg-tertiary)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}
                onClick={() => setExpanded(!expanded)}
            >
                <h2 style={{ margin: 0 }}>Base de Datos: {name}</h2>
                <span className={`collection-status status-${data.status}`}>
                    {data.status === 'equal' ? 'Igual' : 'Diferentes'}
                </span>
            </div>

            {expanded && (
                <div style={{ paddingLeft: '1rem', borderLeft: '2px solid var(--border)' }}>
                    {Object.entries(data.collections).map(([colName, colData]) => (
                        <CollectionView key={colName} name={colName} data={colData} dbLabels={dbLabels} />
                    ))}
                    {Object.keys(data.collections).length === 0 && <p>No hay colecciones comparables.</p>}
                </div>
            )}
        </div>
    );
}

export default function DiffViewer({ results, dbLabels = ['BD 1', 'BD 2'] }) {
    if (!results || Object.keys(results).length === 0) {
        return <div className="card"><p>No se encontraron bases de datos o resultados.</p></div>;
    }

    return (
        <div className="diff-container">
            {Object.entries(results).map(([dbName, dbData]) => (
                <DatabaseView key={dbName} name={dbName} data={dbData} dbLabels={dbLabels} />
            ))}
        </div>
    );
}
