require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { create: createDiff } = require('jsondiffpatch');

const app = express();
const port = process.env.PORT || 5000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
const MAX_DOCS = parseInt(process.env.MAX_DOCS_PER_COLLECTION) || 50000;
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS) || 300000;

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '10kb' }));

const compareLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'Demasiadas solicitudes. Por favor espere un momento.' },
    standardHeaders: true,
    legacyHeaders: false,
});

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
    if (uri.length > 2048) {
        throw new Error('La URI es demasiado larga (máximo 2048 caracteres)');
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
    console.log(`      [${conn.name}] Fetched ${docs.length}/${totalCount} docs in ${Date.now() - start}ms`);
    return { docs, totalCount, truncated };
}

async function compareCollections(conn1, conn2, colName) {
    console.log(`    > Comparando colección: ${colName}...`);
    const result = {
        status: 'equal',
        diffs: [],
        summary: { count1: 0, count2: 0, truncated: false }
    };

    const [fetch1, fetch2] = await Promise.all([
        fetchDocs(conn1, colName),
        fetchDocs(conn2, colName)
    ]);

    result.summary.count1 = fetch1.totalCount;
    result.summary.count2 = fetch2.totalCount;
    result.summary.truncated = fetch1.truncated || fetch2.truncated;

    const startDiff = Date.now();
    const map1 = new Map(fetch1.docs.map(d => [String(d._id), d]));
    const map2 = new Map(fetch2.docs.map(d => [String(d._id), d]));
    const allIds = new Set([...map1.keys(), ...map2.keys()]);

    for (const id of allIds) {
        const d1 = map1.get(id);
        const d2 = map2.get(id);

        if (!d1) {
            result.diffs.push({ id, status: 'missing_in_db1', doc1: null, doc2: d2 });
            result.status = 'different';
        } else if (!d2) {
            result.diffs.push({ id, status: 'missing_in_db2', doc1: d1, doc2: null });
            result.status = 'different';
        } else {
            const delta = differ.diff(d1, d2);
            if (delta) {
                result.diffs.push({ id, status: 'modified', doc1: d1, doc2: d2 });
                result.status = 'different';
            }
        }
    }
    console.log(`    < Fin ${colName} (${Date.now() - startDiff}ms). Status: ${result.status}`);
    return result;
}

// --- API Routes ---

app.post('/api/compare', compareLimiter, async (req, res) => {
    const { uri1, uri2, prefix1, prefix2, skipCollections } = req.body;

    if (!uri1 || !uri2) {
        return res.status(400).json({ error: 'Faltan las URIs de MongoDB' });
    }

    try {
        validateMongoUri(uri1);
        validateMongoUri(uri2);
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }

    let timedOut = false;
    const timeout = setTimeout(() => {
        timedOut = true;
        if (!res.headersSent) {
            res.status(504).json({ error: `La comparación excedió el tiempo límite de ${REQUEST_TIMEOUT_MS / 1000}s` });
        }
    }, REQUEST_TIMEOUT_MS);

    const ignoredCols = skipCollections
        ? skipCollections.split(',').map(s => s.trim()).filter(s => s.length > 0)
        : [];

    if (ignoredCols.length > 0) console.log('Excluyendo colecciones:', ignoredCols);

    let mainConn1, mainConn2;
    try {
        console.log('---------------------------------------------------');
        console.log('Iniciando comparación...');
        if (prefix1) console.log(`Prefijo URI 1: "${prefix1}"`);
        if (prefix2) console.log(`Prefijo URI 2: "${prefix2}"`);

        // Connect to both in parallel
        [mainConn1, mainConn2] = await Promise.all([
            connectToMongo(uri1),
            connectToMongo(uri2),
        ]);

        const dbMap = new Map();
        const warnings = [];

        // List databases from both connections in parallel
        const [listResult1, listResult2] = await Promise.allSettled([
            mainConn1.db.admin().listDatabases(),
            mainConn2.db.admin().listDatabases(),
        ]);

        if (listResult1.status === 'fulfilled') {
            listResult1.value.databases.forEach(db => {
                const realName = db.name;
                if (['admin', 'local', 'config'].includes(realName)) return;
                const cleanName = (prefix1 && realName.startsWith(prefix1))
                    ? realName.substring(prefix1.length)
                    : realName;
                if (!dbMap.has(cleanName)) dbMap.set(cleanName, {});
                dbMap.get(cleanName).db1 = realName;
            });
        } else {
            const msg = `[URI 1] Error listando bases: ${listResult1.reason.message}`;
            console.warn(msg);
            warnings.push(msg);
            const realName = mainConn1.name;
            const cleanName = (prefix1 && realName.startsWith(prefix1))
                ? realName.substring(prefix1.length)
                : realName;
            if (!dbMap.has(cleanName)) dbMap.set(cleanName, {});
            dbMap.get(cleanName).db1 = realName;
        }

        if (listResult2.status === 'fulfilled') {
            listResult2.value.databases.forEach(db => {
                const realName = db.name;
                if (['admin', 'local', 'config'].includes(realName)) return;
                const cleanName = (prefix2 && realName.startsWith(prefix2))
                    ? realName.substring(prefix2.length)
                    : realName;
                if (!dbMap.has(cleanName)) dbMap.set(cleanName, {});
                dbMap.get(cleanName).db2 = realName;
            });
        } else {
            const msg = `[URI 2] Error listando bases: ${listResult2.reason.message}`;
            console.warn(msg);
            warnings.push(msg);
            const realName = mainConn2.name;
            const cleanName = (prefix2 && realName.startsWith(prefix2))
                ? realName.substring(prefix2.length)
                : realName;
            if (!dbMap.has(cleanName)) dbMap.set(cleanName, {});
            dbMap.get(cleanName).db2 = realName;
        }

        console.log(`Analizando ${dbMap.size} bases de datos en paralelo...`);

        // Process ALL databases in parallel
        const dbResultPairs = await Promise.all(
            [...dbMap.entries()].map(async ([cleanName, names]) => {
                if (timedOut) return [cleanName, null];

                console.log(`  DB: ${cleanName} (BD1: ${names.db1 || 'Falta'}, BD2: ${names.db2 || 'Falta'})`);

                const dbResult = {
                    status: 'equal',
                    collections: {},
                    details: { inServer1: !!names.db1, inServer2: !!names.db2 }
                };

                if (!names.db1 || !names.db2) {
                    dbResult.status = 'missing_database';
                    return [cleanName, dbResult];
                }

                const dbConn1 = mainConn1.useDb(names.db1);
                const dbConn2 = mainConn2.useDb(names.db2);

                // List collections from both DBs in parallel
                const [colList1, colList2] = await Promise.allSettled([
                    dbConn1.db.listCollections().toArray(),
                    dbConn2.db.listCollections().toArray(),
                ]);

                const cols1 = colList1.status === 'fulfilled'
                    ? colList1.value.map(c => c.name)
                    : (console.warn(`Error cols ${names.db1}: ${colList1.reason.message}`), []);

                const cols2 = colList2.status === 'fulfilled'
                    ? colList2.value.map(c => c.name)
                    : (console.warn(`Error cols ${names.db2}: ${colList2.reason.message}`), []);

                const allCols = [...new Set([...cols1, ...cols2])]
                    .filter(col => !ignoredCols.includes(col));

                // Process ALL collections in parallel
                const colResultPairs = await Promise.all(
                    allCols.map(async (col) => {
                        if (timedOut) return { col, data: null };

                        const colIn1 = cols1.includes(col);
                        const colIn2 = cols2.includes(col);

                        if (colIn1 && colIn2) {
                            const comparison = await compareCollections(dbConn1, dbConn2, col);
                            return { col, data: comparison };
                        }

                        return {
                            col,
                            data: {
                                status: 'missing_collection',
                                summary: { inDb1: colIn1, inDb2: colIn2 }
                            }
                        };
                    })
                );

                for (const { col, data } of colResultPairs) {
                    if (!data) continue;
                    dbResult.collections[col] = data;
                    if (data.status !== 'equal') dbResult.status = 'different';
                }

                return [cleanName, dbResult];
            })
        );

        const fullResults = Object.fromEntries(
            dbResultPairs.filter(([, v]) => v !== null)
        );

        if (!timedOut && !res.headersSent) {
            const response = { success: true, results: fullResults };
            if (warnings.length > 0) response.warnings = warnings;
            res.json(response);
        }

    } catch (error) {
        console.error('Comparison error:', error);
        if (!res.headersSent) {
            let message = 'Error interno en la comparación.';
            if (error.code === 18 || error.codeName === 'AuthenticationFailed') {
                message = 'Error de autenticación: credenciales incorrectas en la URI.';
            } else if (error.name === 'MongoNetworkError' || error.code === 'ECONNREFUSED') {
                message = 'No se pudo conectar al servidor MongoDB. Verifique que esté activo y accesible.';
            } else if (error.name === 'MongoServerSelectionError') {
                message = 'No se encontró el servidor MongoDB. Verifique la URI y el puerto.';
            }
            res.status(500).json({ error: message });
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
    console.log(`Rate limit: 10 requests/min`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`ERROR: El puerto ${port} ya está en uso. Cierre la otra instancia o cambie el puerto en .env`);
    } else {
        console.error('ERROR al iniciar el servidor:', err.message);
    }
    process.exit(1);
});
