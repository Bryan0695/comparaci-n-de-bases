import React, { useState, useMemo } from 'react';

// ─── Line-diff engine (same LCS algorithm as JsonDiffViewer) ─────────────────

function computeLineDiff(lines1, lines2) {
    const m = lines1.length;
    const n = lines2.length;

    if (m * n > 800_000) {
        const max = Math.max(m, n);
        return Array.from({ length: max }, (_, i) => {
            const l = lines1[i] ?? null;
            const r = lines2[i] ?? null;
            return l === r
                ? { left: l, right: r, type: 'equal', ln1: i + 1, ln2: i + 1 }
                : { left: l, right: r,
                    type: l !== null && r !== null ? 'changed' : l !== null ? 'removed' : 'added',
                    ln1: l !== null ? i + 1 : null,
                    ln2: r !== null ? i + 1 : null };
        });
    }

    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = lines1[i-1] === lines2[j-1]
                ? dp[i-1][j-1] + 1
                : Math.max(dp[i-1][j], dp[i][j-1]);

    const ops = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && lines1[i-1] === lines2[j-1]) {
            ops.unshift({ type: 'equal', t1: lines1[i-1], t2: lines2[j-1] }); i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
            ops.unshift({ type: 'insert', t2: lines2[j-1] }); j--;
        } else {
            ops.unshift({ type: 'delete', t1: lines1[i-1] }); i--;
        }
    }

    const rows = [];
    let ln1 = 0, ln2 = 0, k = 0;
    while (k < ops.length) {
        const op = ops[k];
        if (op.type === 'equal') {
            ln1++; ln2++;
            rows.push({ left: op.t1, right: op.t2, type: 'equal', ln1, ln2 });
            k++;
        } else if (op.type === 'delete') {
            ln1++;
            if (k + 1 < ops.length && ops[k+1].type === 'insert') {
                ln2++;
                rows.push({ left: op.t1, right: ops[k+1].t2, type: 'changed', ln1, ln2 });
                k += 2;
            } else {
                rows.push({ left: op.t1, right: null, type: 'removed', ln1, ln2: null });
                k++;
            }
        } else {
            ln2++;
            rows.push({ left: null, right: op.t2, type: 'added', ln1: null, ln2 });
            k++;
        }
    }
    return rows;
}

function withOnlyDiffs(allRows) {
    const keep = new Set();
    allRows.forEach((row, i) => {
        if (row.type !== 'equal')
            for (let c = Math.max(0, i-2); c <= Math.min(allRows.length-1, i+2); c++)
                keep.add(c);
    });
    if (keep.size === 0) return allRows;
    const result = [];
    let prev = -1;
    for (const idx of [...keep].sort((a, b) => a - b)) {
        if (prev !== -1 && idx > prev + 1)
            result.push({ left: null, right: null, type: 'separator', ln1: null, ln2: null });
        result.push(allRows[idx]);
        prev = idx;
    }
    return result;
}

// ─── Split-panel renderer ─────────────────────────────────────────────────────

function SdiffPanel({ rows, side, label }) {
    return (
        <div className="sdiff-panel">
            <div className={`sdiff-header sdiff-header--${side}`}>{label}</div>
            <pre className="sdiff-code">
                {rows.map((row, idx) => {
                    if (row.type === 'separator') {
                        return (
                            <div key={idx} className="sdiff-line sdiff-line--equal"
                                style={{ justifyContent: 'center', color: 'var(--text-secondary)', fontStyle: 'italic', opacity: 0.6 }}>
                                <span className="sdiff-text" style={{ paddingLeft: '1rem' }}>···</span>
                            </div>
                        );
                    }
                    const isLeft = side === 'left';
                    const text = isLeft ? row.left : row.right;
                    const lineNum = isLeft ? row.ln1 : row.ln2;
                    let cls = 'sdiff-line';
                    if      (row.type === 'equal')   cls += ' sdiff-line--equal';
                    else if (row.type === 'removed') cls += isLeft ? ' sdiff-line--removed'     : ' sdiff-line--phantom';
                    else if (row.type === 'added')   cls += isLeft ? ' sdiff-line--phantom'     : ' sdiff-line--added';
                    else if (row.type === 'changed') cls += isLeft ? ' sdiff-line--changed-old' : ' sdiff-line--changed-new';
                    return (
                        <div key={idx} className={cls}>
                            <span className="sdiff-ln">{lineNum ?? ''}</span>
                            <span className="sdiff-text">{text ?? ''}</span>
                        </div>
                    );
                })}
            </pre>
        </div>
    );
}

// ─── Single diff item (one document) ─────────────────────────────────────────

function DiffItem({ id, doc1, doc2, status, dbLabels }) {
    const [expanded, setExpanded] = useState(false);
    const [onlyDiffs, setOnlyDiffs] = useState(true);

    const isMissing = status === 'missing_in_db1' || status === 'missing_in_db2';

    const allRows = useMemo(() => {
        const lines1 = doc1 ? JSON.stringify(doc1, null, 2).split('\n') : [];
        const lines2 = doc2 ? JSON.stringify(doc2, null, 2).split('\n') : [];
        return computeLineDiff(lines1, lines2);
    }, [doc1, doc2]);

    const diffCount = useMemo(
        () => allRows.filter(r => r.type !== 'equal').length,
        [allRows]
    );

    const rows = useMemo(
        () => (onlyDiffs && !isMissing) ? withOnlyDiffs(allRows) : allRows,
        [allRows, onlyDiffs, isMissing]
    );

    const labelLeft  = status === 'missing_in_db1' ? `${dbLabels[0]} — no existe` : dbLabels[0];
    const labelRight = status === 'missing_in_db2' ? `${dbLabels[1]} — no existe` : dbLabels[1];

    const badge = isMissing
        ? (status === 'missing_in_db1' ? `Solo en ${dbLabels[1]}` : `Solo en ${dbLabels[0]}`)
        : `${diffCount} campo(s) diferente(s)`;

    return (
        <div className="diff-item">
            <div className="diff-item-header" onClick={() => setExpanded(e => !e)}>
                <span className="diff-item-id">ID: {String(id)}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span className="collection-status status-different">{badge}</span>
                    <small style={{ color: 'var(--text-secondary)' }}>{expanded ? '▼' : '▶'}</small>
                </div>
            </div>

            {expanded && (
                <div className="diff-item-body">
                    {!isMissing && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0.5rem 0' }}>
                            <label className="sdiff-toggle">
                                <input
                                    type="checkbox"
                                    checked={onlyDiffs}
                                    onChange={e => setOnlyDiffs(e.target.checked)}
                                />
                                Solo diferencias
                            </label>
                        </div>
                    )}
                    <div className="sdiff-container">
                        <SdiffPanel rows={rows} side="left"  label={labelLeft}  />
                        <div className="sdiff-divider" />
                        <SdiffPanel rows={rows} side="right" label={labelRight} />
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Collection / Database / root views (unchanged logic, cleaned up) ─────────

function CollectionView({ name, data, dbLabels }) {
    const [expanded, setExpanded] = useState(false);

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
            <div className="collection-header" onClick={() => setExpanded(e => !e)}>
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
                        <p>
                            Docs en {dbLabels[0]}: {data.summary.count1}
                            {' | '}
                            Docs en {dbLabels[1]}: {data.summary.count2}
                        </p>
                        {data.summary.truncated && (
                            <p style={{ color: '#f59e0b', fontSize: '0.85rem' }}>
                                Resultados truncados: la colección excede el límite máximo de documentos comparables.
                            </p>
                        )}
                    </div>

                    {data.diffs && data.diffs.length > 0 && (
                        <div className="diff-list">
                            {data.diffs.map(d => (
                                <DiffItem
                                    key={d.id}
                                    id={d.id}
                                    doc1={d.doc1}
                                    doc2={d.doc2}
                                    status={d.status}
                                    dbLabels={dbLabels}
                                />
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
                <h3>
                    Base de Datos: {name} —{' '}
                    <span style={{ color: 'var(--danger)' }}>no existe en ambas</span>
                </h3>
            </div>
        );
    }

    return (
        <div style={{ marginBottom: '2rem' }}>
            <div
                className="card"
                style={{ background: 'var(--bg-tertiary)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}
                onClick={() => setExpanded(e => !e)}
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
                    {Object.keys(data.collections).length === 0 && (
                        <p>No hay colecciones comparables.</p>
                    )}
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
