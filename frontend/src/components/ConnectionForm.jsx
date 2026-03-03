import React, { useState } from 'react';

export default function ConnectionForm({ onCompare, isLoading }) {
    const [uri1, setUri1] = useState('');
    const [uri2, setUri2] = useState('');
    const [name1, setName1] = useState('');
    const [name2, setName2] = useState('');
    const [prefix1, setPrefix1] = useState('');
    const [prefix2, setPrefix2] = useState('');
    const [skipCollections, setSkipCollections] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (uri1 && uri2) {
            onCompare(uri1, uri2, prefix1, prefix2, skipCollections, name1, name2);
        }
    };

    return (
        <div className="card">
            <h2>Conexión</h2>
            <form onSubmit={handleSubmit}>

                {/* ── Conexión 1 ── */}
                <div className="form-group">
                    <label>Base de Datos 1 (URI)</label>
                    <input
                        type="text"
                        placeholder="mongodb://localhost:27017/db1"
                        value={uri1}
                        onChange={(e) => setUri1(e.target.value)}
                        disabled={isLoading}
                    />
                    <div className="conn-aux">
                        <div className="conn-aux-field">
                            <span className="conn-aux-label">Nombre</span>
                            <input
                                type="text"
                                placeholder="Ej: Producción"
                                value={name1}
                                onChange={(e) => setName1(e.target.value)}
                                disabled={isLoading}
                            />
                        </div>
                        <div className="conn-aux-field">
                            <span className="conn-aux-label">Ignorar prefijo</span>
                            <input
                                type="text"
                                placeholder="Ej: BO_"
                                value={prefix1}
                                onChange={(e) => setPrefix1(e.target.value)}
                                disabled={isLoading}
                            />
                        </div>
                    </div>
                </div>

                {/* ── Conexión 2 ── */}
                <div className="form-group">
                    <label>Base de Datos 2 (URI)</label>
                    <input
                        type="text"
                        placeholder="mongodb://localhost:27017/db2"
                        value={uri2}
                        onChange={(e) => setUri2(e.target.value)}
                        disabled={isLoading}
                    />
                    <div className="conn-aux">
                        <div className="conn-aux-field">
                            <span className="conn-aux-label">Nombre</span>
                            <input
                                type="text"
                                placeholder="Ej: QA"
                                value={name2}
                                onChange={(e) => setName2(e.target.value)}
                                disabled={isLoading}
                            />
                        </div>
                        <div className="conn-aux-field">
                            <span className="conn-aux-label">Ignorar prefijo</span>
                            <input
                                type="text"
                                placeholder="Ej: QA_KFC_"
                                value={prefix2}
                                onChange={(e) => setPrefix2(e.target.value)}
                                disabled={isLoading}
                            />
                        </div>
                    </div>
                </div>

                {/* ── Excluir colecciones ── */}
                <div className="form-group">
                    <label>Excluir Colecciones (separadas por coma)</label>
                    <input
                        type="text"
                        placeholder="Ej: WorkflowExecutionLog, Logs, Audit"
                        value={skipCollections}
                        onChange={(e) => setSkipCollections(e.target.value)}
                        disabled={isLoading}
                    />
                </div>

                <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={isLoading || !uri1 || !uri2}
                >
                    {isLoading ? 'Comparando...' : 'Comparar Bases de Datos'}
                </button>
            </form>
        </div>
    );
}
