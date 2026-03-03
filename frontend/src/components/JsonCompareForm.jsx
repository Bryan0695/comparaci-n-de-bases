import React, { useState } from 'react';

export default function JsonCompareForm({ onCompare }) {
    const [json1, setJson1] = useState('');
    const [json2, setJson2] = useState('');
    const [error1, setError1] = useState('');
    const [error2, setError2] = useState('');

    const parseAndValidate = (str, setError) => {
        const trimmed = str.trim();
        if (!trimmed) {
            setError('El campo no puede estar vacío');
            return null;
        }
        try {
            const parsed = JSON.parse(trimmed);
            setError('');
            return parsed;
        } catch (e) {
            setError(`JSON inválido: ${e.message}`);
            return null;
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        const parsed1 = parseAndValidate(json1, setError1);
        const parsed2 = parseAndValidate(json2, setError2);
        if (parsed1 !== null && parsed2 !== null) {
            onCompare(parsed1, parsed2);
        }
    };

    const handleChange1 = (e) => {
        setJson1(e.target.value);
        if (error1) setError1('');
    };

    const handleChange2 = (e) => {
        setJson2(e.target.value);
        if (error2) setError2('');
    };

    return (
        <div className="card">
            <h2>Comparar JSON</h2>
            <form onSubmit={handleSubmit}>
                <div className="json-inputs">
                    <div className="form-group">
                        <label>JSON 1</label>
                        <textarea
                            className={`json-textarea${error1 ? ' json-textarea--invalid' : ''}`}
                            value={json1}
                            onChange={handleChange1}
                            placeholder={'{\n  "clave": "valor"\n}'}
                            spellCheck={false}
                        />
                        {error1 && <span className="field-error">{error1}</span>}
                    </div>
                    <div className="form-group">
                        <label>JSON 2</label>
                        <textarea
                            className={`json-textarea${error2 ? ' json-textarea--invalid' : ''}`}
                            value={json2}
                            onChange={handleChange2}
                            placeholder={'{\n  "clave": "valor"\n}'}
                            spellCheck={false}
                        />
                        {error2 && <span className="field-error">{error2}</span>}
                    </div>
                </div>
                <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={!json1.trim() || !json2.trim()}
                >
                    Comparar JSON
                </button>
            </form>
        </div>
    );
}
