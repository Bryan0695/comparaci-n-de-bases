import React, { useMemo, useState } from 'react';

/**
 * LCS-based line diff.
 * Returns rows: { left, right, type, ln1, ln2 }
 *   type: 'equal' | 'changed' | 'removed' | 'added'
 *   left/right: string or null (null = phantom blank row)
 *   ln1/ln2: line number in original JSON (null for phantom rows)
 */
function computeLineDiff(lines1, lines2) {
    const m = lines1.length;
    const n = lines2.length;

    // For very large inputs skip LCS to avoid O(m*n) memory
    if (m * n > 800_000) {
        const rows = [];
        const max = Math.max(m, n);
        for (let i = 0; i < max; i++) {
            const l = lines1[i] ?? null;
            const r = lines2[i] ?? null;
            if (l === r) rows.push({ left: l, right: r, type: 'equal', ln1: i + 1, ln2: i + 1 });
            else rows.push({ left: l, right: r, type: l !== null && r !== null ? 'changed' : l !== null ? 'removed' : 'added', ln1: l !== null ? i + 1 : null, ln2: r !== null ? i + 1 : null });
        }
        return rows;
    }

    // Build LCS DP table
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = lines1[i - 1] === lines2[j - 1]
                ? dp[i - 1][j - 1] + 1
                : Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
    }

    // Backtrack to get the edit script
    const ops = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && lines1[i - 1] === lines2[j - 1]) {
            ops.unshift({ type: 'equal', text1: lines1[i - 1], text2: lines2[j - 1] });
            i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            ops.unshift({ type: 'insert', text2: lines2[j - 1] });
            j--;
        } else {
            ops.unshift({ type: 'delete', text1: lines1[i - 1] });
            i--;
        }
    }

    // Build final rows, pairing consecutive delete+insert as 'changed'
    const rows = [];
    let ln1 = 0, ln2 = 0;
    let k = 0;
    while (k < ops.length) {
        const op = ops[k];
        if (op.type === 'equal') {
            ln1++; ln2++;
            rows.push({ left: op.text1, right: op.text2, type: 'equal', ln1, ln2 });
            k++;
        } else if (op.type === 'delete') {
            ln1++;
            if (k + 1 < ops.length && ops[k + 1].type === 'insert') {
                ln2++;
                rows.push({ left: op.text1, right: ops[k + 1].text2, type: 'changed', ln1, ln2 });
                k += 2;
            } else {
                rows.push({ left: op.text1, right: null, type: 'removed', ln1, ln2: null });
                k++;
            }
        } else {
            ln2++;
            rows.push({ left: null, right: op.text2, type: 'added', ln1: null, ln2 });
            k++;
        }
    }
    return rows;
}

function DiffPanel({ rows, side }) {
    return (
        <div className="sdiff-panel">
            <div className={`sdiff-header sdiff-header--${side}`}>
                {side === 'left' ? 'JSON 1' : 'JSON 2'}
            </div>
            <pre className="sdiff-code">
                {rows.map((row, idx) => {
                    const isLeft = side === 'left';
                    const text = isLeft ? row.left : row.right;
                    const lineNum = isLeft ? row.ln1 : row.ln2;

                    let cls = 'sdiff-line';
                    if (row.type === 'separator')    cls += ' sdiff-line--equal'; // reuse style, text is '···'
                    else if (row.type === 'equal')   cls += ' sdiff-line--equal';
                    else if (row.type === 'removed') cls += isLeft ? ' sdiff-line--removed' : ' sdiff-line--phantom';
                    else if (row.type === 'added')   cls += isLeft ? ' sdiff-line--phantom' : ' sdiff-line--added';
                    else if (row.type === 'changed') cls += isLeft ? ' sdiff-line--changed-old' : ' sdiff-line--changed-new';

                    if (row.type === 'separator') {
                        return (
                            <div key={idx} className="sdiff-line sdiff-line--equal" style={{ justifyContent: 'center', color: 'var(--text-secondary)', fontStyle: 'italic', opacity: 0.6 }}>
                                <span className="sdiff-text" style={{ paddingLeft: '1rem' }}>···</span>
                            </div>
                        );
                    }

                    return (
                        <div key={idx} className={cls}>
                            <span className="sdiff-ln">
                                {lineNum ?? ''}
                            </span>
                            <span className="sdiff-text">{text ?? ''}</span>
                        </div>
                    );
                })}
            </pre>
        </div>
    );
}

export default function JsonDiffViewer({ json1, json2 }) {
    const [onlyDiffs, setOnlyDiffs] = useState(false);

    const allRows = useMemo(() => {
        const lines1 = JSON.stringify(json1, null, 2).split('\n');
        const lines2 = JSON.stringify(json2, null, 2).split('\n');
        return computeLineDiff(lines1, lines2);
    }, [json1, json2]);

    const diffCount = useMemo(
        () => allRows.filter(r => r.type !== 'equal').length,
        [allRows]
    );

    const rows = useMemo(() => {
        if (!onlyDiffs) return allRows;
        // Show diff lines + 2 context lines above/below each diff block
        const keep = new Set();
        allRows.forEach((row, i) => {
            if (row.type !== 'equal') {
                for (let c = Math.max(0, i - 2); c <= Math.min(allRows.length - 1, i + 2); c++) {
                    keep.add(c);
                }
            }
        });
        if (keep.size === 0) return allRows;
        // Insert separator markers between non-consecutive ranges
        const result = [];
        let prev = -1;
        for (const idx of [...keep].sort((a, b) => a - b)) {
            if (prev !== -1 && idx > prev + 1) {
                result.push({ left: '···', right: '···', type: 'separator', ln1: null, ln2: null });
            }
            result.push(allRows[idx]);
            prev = idx;
        }
        return result;
    }, [allRows, onlyDiffs]);

    const hasDiffs = diffCount > 0;

    return (
        <div className="card">
            <div className="json-result-header">
                <h2>Resultado</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    {hasDiffs && (
                        <label className="sdiff-toggle">
                            <input
                                type="checkbox"
                                checked={onlyDiffs}
                                onChange={e => setOnlyDiffs(e.target.checked)}
                            />
                            Solo diferencias
                        </label>
                    )}
                    {hasDiffs ? (
                        <span className="collection-status status-different">
                            {diffCount} línea(s) diferente(s)
                        </span>
                    ) : (
                        <span className="collection-status status-equal">Idénticos</span>
                    )}
                </div>
            </div>

            {!hasDiffs ? (
                <p style={{ color: 'var(--success)', marginTop: '1rem' }}>
                    Los dos JSON son completamente idénticos.
                </p>
            ) : (
                <div className="sdiff-container">
                    <DiffPanel rows={rows} side="left" />
                    <div className="sdiff-divider" />
                    <DiffPanel rows={rows} side="right" />
                </div>
            )}
        </div>
    );
}
