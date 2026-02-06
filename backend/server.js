require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { create: createDiff } = require('jsondiffpatch');

const app = express();
const port = process.env.PORT || 5000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
const MAX_DOCS = parseInt(process.env.MAX_DOCS_PER_COLLECTION) || 50000;
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS) || 300000; // 5 min

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

const differ = createDiff({
    objectHash: function (obj, index) {
        return obj._id || obj.id || ('$$index:' + index);
    }
});

// --- Validation ---

function validateMongoUri(uri) {
    if (typeof uri !== 'string' || uri.trim().length === 0) {
        throw new Error('La URI de MongoDB no puede estar vacía');
    }
    try {
        const parsed = new URL(uri);
        if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol)) {
            throw new Error('Protocolo inválido - debe ser mongodb:// o mongodb+srv://');
        }
    } catch (e) {
        if (e.message.includes('Protocolo inválido')) throw e;
        throw new Error(`URI de MongoDB inválida: ${e.message}`);
    }
}

// --- Core functions ---

async function connectToMongo(uri) {
    return await mongoose.createConnection(uri).asPromise();
}

async function fetchDocs(conn, collectionName) {
    console.log(`      [${conn.name}] Fetching docs from ${collectionName}...`);
    const start = Date.now();
    const collection = conn.db.collection(collectionName);
    const totalCount = await collection.countDocuments();
    let truncated = false;

    if (totalCount > MAX_DOCS) {
        console.warn(`      [WARN] ${collectionName} tiene ${totalCount} docs, limitando a ${MAX_DOCS}`);
        truncated = true;
    }

    const docs = await collection.find({}).sort({ _id: 1 }).limit(MAX_DOCS).toArray();
    console.log(`      [${conn.name}] Fetched ${docs.length}/${totalCount} docs from ${collectionName} in ${Date.now() - start}ms`);
    return { docs, totalCount, truncated };
}

async function compareCollections(conn1, conn2, colName) {
    console.log(`    > Comparando colección: ${colName}...`);
    const result = {
        status: 'equal',
        diffs: [],
        summary: { count1: 0, count2: 0, truncated: false }
    };

    // Fetch from both DBs in parallel
    const [fetch1, fetch2] = await Promise.all([
        fetchDocs(conn1, colName),
        fetchDocs(conn2, colName)
    ]);

    const docs1 = fetch1.docs;
    const docs2 = fetch2.docs;

    result.summary.count1 = fetch1.totalCount;
    result.summary.count2 = fetch2.totalCount;
    result.summary.truncated = fetch1.truncated || fetch2.truncated;

    console.log(`      Calculando diferencias en memoria para ${colName}...`);
    const startDiff = Date.now();

    const map1 = new Map(docs1.map(d => [String(d._id), d]));
    const map2 = new Map(docs2.map(d => [String(d._id), d]));
    const allIds = new Set([...map1.keys(), ...map2.keys()]);

    for (const id of allIds) {
        const d1 = map1.get(id);
        const d2 = map2.get(id);

        if (!d1) {
            result.diffs.push({ id, status: 'missing_in_db1', diff: null });
            result.status = 'different';
        } else if (!d2) {
            result.diffs.push({ id, status: 'missing_in_db2', diff: null });
            result.status = 'different';
        } else {
            const delta = differ.diff(d1, d2);
            if (delta) {
                result.diffs.push({ id, status: 'modified', diff: delta });
                result.status = 'different';
            }
        }
    }
    console.log(`    < Fin comparación ${colName} (${Date.now() - startDiff}ms). Status: ${result.status}`);
    return result;
}

// --- API Route ---

app.post('/api/compare', async (req, res) => {
    const { uri1, uri2, prefix1, prefix2, skipCollections } = req.body;

    // Validation
    if (!uri1 || !uri2) {
        return res.status(400).json({ error: 'Faltan las URIs de MongoDB' });
    }

    try {
        validateMongoUri(uri1);
        validateMongoUri(uri2);
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }

    // Request timeout
    let timedOut = false;
    const timeout = setTimeout(() => {
        timedOut = true;
        if (!res.headersSent) {
            res.status(504).json({ error: `La comparación excedió el tiempo límite de ${REQUEST_TIMEOUT_MS / 1000} segundos` });
        }
    }, REQUEST_TIMEOUT_MS);

    // Parse excluded collections
    const ignoredCols = skipCollections
        ? skipCollections.split(',').map(s => s.trim()).filter(s => s.length > 0)
        : [];

    if (ignoredCols.length > 0) console.log('Excluyendo colecciones:', ignoredCols);

    let mainConn1, mainConn2;
    try {
        console.log('---------------------------------------------------');
        console.log('Iniciando comparación con normalización de nombres...');
        if (prefix1) console.log(`Ignorando prefijo URI 1: "${prefix1}"`);
        if (prefix2) console.log(`Ignorando prefijo URI 2: "${prefix2}"`);

        mainConn1 = await connectToMongo(uri1);
        mainConn2 = await connectToMongo(uri2);

        // Map: CleanName -> { db1: RealName, db2: RealName }
        const dbMap = new Map();
        const warnings = [];

        // Process URI 1 DBs
        try {
            const admin1 = mainConn1.db.admin();
            const dbs1 = await admin1.listDatabases();
            dbs1.databases.forEach(db => {
                const realName = db.name;
                if (realName === 'admin' || realName === 'local' || realName === 'config') return;

                let cleanName = realName;
                if (prefix1 && cleanName.startsWith(prefix1)) {
                    cleanName = cleanName.substring(prefix1.length);
                }

                if (!dbMap.has(cleanName)) dbMap.set(cleanName, {});
                dbMap.get(cleanName).db1 = realName;
            });
        } catch (e) {
            const msg = `[URI 1] Error listando bases: ${e.message}`;
            console.warn(msg);
            warnings.push(msg);
            // Fallback: use the connection's default DB
            const realName = mainConn1.name;
            let cleanName = realName;
            if (prefix1 && cleanName.startsWith(prefix1)) cleanName = cleanName.substring(prefix1.length);
            if (!dbMap.has(cleanName)) dbMap.set(cleanName, {});
            dbMap.get(cleanName).db1 = realName;
        }

        // Process URI 2 DBs
        try {
            const admin2 = mainConn2.db.admin();
            const dbs2 = await admin2.listDatabases();
            dbs2.databases.forEach(db => {
                const realName = db.name;
                if (realName === 'admin' || realName === 'local' || realName === 'config') return;

                let cleanName = realName;
                if (prefix2 && cleanName.startsWith(prefix2)) {
                    cleanName = cleanName.substring(prefix2.length);
                }

                if (!dbMap.has(cleanName)) dbMap.set(cleanName, {});
                dbMap.get(cleanName).db2 = realName;
            });
        } catch (e) {
            const msg = `[URI 2] Error listando bases: ${e.message}`;
            console.warn(msg);
            warnings.push(msg);
            const realName = mainConn2.name;
            let cleanName = realName;
            if (prefix2 && cleanName.startsWith(prefix2)) cleanName = cleanName.substring(prefix2.length);
            if (!dbMap.has(cleanName)) dbMap.set(cleanName, {});
            dbMap.get(cleanName).db2 = realName;
        }

        const fullResults = {};
        console.log(`Analizando ${dbMap.size} bases de datos canónicas...`);

        for (const [cleanName, names] of dbMap.entries()) {
            if (timedOut) break;

            console.log(`Procesando: ${cleanName} (BD1: ${names.db1 || 'Falta'}, BD2: ${names.db2 || 'Falta'})`);

            const dbResult = {
                status: 'equal',
                collections: {},
                details: { inServer1: !!names.db1, inServer2: !!names.db2 }
            };

            let cols1 = [], cols2 = [];
            let dbConn1, dbConn2;

            if (names.db1) {
                dbConn1 = mainConn1.useDb(names.db1);
                try {
                    cols1 = (await dbConn1.db.listCollections().toArray()).map(c => c.name);
                } catch (e) {
                    console.warn(`Error listing cols in ${names.db1}: ${e.message}`);
                }
            }

            if (names.db2) {
                dbConn2 = mainConn2.useDb(names.db2);
                try {
                    cols2 = (await dbConn2.db.listCollections().toArray()).map(c => c.name);
                } catch (e) {
                    console.warn(`Error listing cols in ${names.db2}: ${e.message}`);
                }
            }

            if (!names.db1 && !names.db2) continue;

            if (names.db1 && names.db2) {
                const allCols = new Set([...cols1, ...cols2]);
                for (const col of allCols) {
                    if (timedOut) break;

                    if (ignoredCols.includes(col)) {
                        console.log(`    [SKIP] Ignorando colección excluida por usuario: ${col}`);
                        continue;
                    }

                    const colIn1 = cols1.includes(col);
                    const colIn2 = cols2.includes(col);

                    if (colIn1 && colIn2) {
                        const comparison = await compareCollections(dbConn1, dbConn2, col);
                        dbResult.collections[col] = comparison;
                        if (comparison.status === 'different') dbResult.status = 'different';
                    } else {
                        dbResult.collections[col] = {
                            status: 'missing_collection',
                            summary: { inDb1: colIn1, inDb2: colIn2 }
                        };
                        dbResult.status = 'different';
                    }
                }
            } else {
                dbResult.status = 'missing_database';
            }

            fullResults[cleanName] = dbResult;
        }

        if (!timedOut && !res.headersSent) {
            const response = { success: true, results: fullResults };
            if (warnings.length > 0) {
                response.warnings = warnings;
            }
            res.json(response);
        }

    } catch (error) {
        console.error('Comparison error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Error interno en la comparación. Revise las URIs e intente de nuevo.' });
        }
    } finally {
        clearTimeout(timeout);
        if (mainConn1) await mainConn1.close().catch(() => {});
        if (mainConn2) await mainConn2.close().catch(() => {});
    }
});

const server = app.listen(port, () => {
    console.log(`Backend running on http://localhost:${port}`);
    console.log(`CORS origin: ${CORS_ORIGIN}`);
    console.log(`Max docs per collection: ${MAX_DOCS}`);
    console.log(`Request timeout: ${REQUEST_TIMEOUT_MS / 1000}s`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`ERROR: El puerto ${port} ya está en uso. Cierre la otra instancia o cambie el puerto en .env`);
    } else {
        console.error('ERROR al iniciar el servidor:', err.message);
    }
    process.exit(1);
});
