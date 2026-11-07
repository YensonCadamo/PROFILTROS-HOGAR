const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const defaultDb = {
    master: 'admin',
    users: [
        { username: 'elias', password: '123' }
    ],
    clients: [],
    records: [],
    company: {
        name: 'Profiltros Hogar, C.A.',
        rif: 'J-50150423-7',
        phone: '0412-698.81.15',
        address: 'Calle 23 de Enero, Local S/N, Sector La Aduana, Barcelona, Estado Anzoátegui',
        email: 'profiltroshogar@gmail.com',
        instagram: 'Profiltroshogar.c.a',
        facebook: 'profiltrohoga Ca'
    },
    logoDataUrl: null,
    logoVersion: 0
};

function readDb() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb, null, 2));
    }
    try {
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
        return defaultDb;
    }
}

function writeDb(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Basic ')) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    const b64Auth = authHeader.split(' ')[1];
    const [username, password] = Buffer.from(b64Auth, 'base64').toString('utf8').split(':');

    const db = readDb();
    if (username === db.master || db.users.some(u => u.username === username && u.password === password)) {
        req.user = username;
        return next();
    }
    return res.status(401).json({ error: 'Credenciales inválidas' });
}

// Rutas públicas que no requieren token obligatorio o se manejan de forma directa
app.use((req, res, next) => {
    if (req.path === '/' || req.path === '/index.html' || req.path === '/api/login' || req.path.startsWith('/api/accounts/') || req.path === '/api/logo' || req.path === '/api/backup') {
        return next();
    }
    return authMiddleware(req, res, next);
});

app.use(express.static(__dirname));

app.get('/api/login', (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Basic ')) {
        return res.status(401).send('Unauthorized');
    }
    const b64Auth = authHeader.split(' ')[1];
    const [username, password] = Buffer.from(b64Auth, 'base64').toString('utf8').split(':');
    const db = readDb();

    if (username === db.master || db.users.some(u => u.username === username && u.password === password)) {
        return res.status(200).json({ success: true });
    }
    return res.status(401).json({ error: 'Credenciales incorrectas' });
});

app.post('/api/accounts/list', (req, res) => {
    const db = readDb();
    res.json({ master: db.master, users: db.users.map(u => ({ username: u.username })) });
});

app.post('/api/accounts/create', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Faltan datos' });
    const db = readDb();
    if (db.users.some(u => u.username === username) || db.master === username) {
        return res.status(400).json({ error: 'El usuario ya existe' });
    }
    db.users.push({ username, password });
    writeDb(db);
    res.json({ success: true, username });
});

app.post('/api/accounts/delete', (req, res) => {
    const { username } = req.body;
    const db = readDb();
    db.users = db.users.filter(u => u.username !== username);
    writeDb(db);
    res.json({ success: true });
});

app.get('/api/data', (req, res) => {
    const db = readDb();
    res.json({
        clients: db.clients,
        records: db.records,
        company: db.company,
        logoVersion: db.logoVersion
    });
});

// Ruta para descargar el database.json completo con absolutamente todo
app.get('/api/backup', (req, res) => {
    const db = readDb();
    res.json(db);
});

app.put('/api/clients/:id', (req, res) => {
    const id = req.params.id;
    const clientData = req.body;
    const db = readDb();
    const index = db.clients.findIndex(c => c.id == id);
    if (index !== -1) {
        db.clients[index] = clientData;
    } else {
        db.clients.push(clientData);
    }
    writeDb(db);
    res.json({ success: true });
});

app.delete('/api/clients/:id', (req, res) => {
    const id = req.params.id;
    const db = readDb();
    db.clients = db.clients.filter(c => c.id != id);
    writeDb(db);
    res.json({ success: true });
});

app.put('/api/records/:id', (req, res) => {
    const id = req.params.id;
    const recordData = req.body;
    const db = readDb();
    const index = db.records.findIndex(r => r.id == id);
    if (index !== -1) {
        db.records[index] = recordData;
    } else {
        db.records.push(recordData);
    }
    writeDb(db);
    res.json({ success: true });
});

app.delete('/api/records/:id', (req, res) => {
    const id = req.params.id;
    const db = readDb();
    db.records = db.records.filter(r => r.id != id);
    writeDb(db);
    res.json({ success: true });
});

app.put('/api/settings/company', (req, res) => {
    const db = readDb();
    db.company = { ...db.company, ...req.body };
    writeDb(db);
    res.json({ success: true, company: db.company });
});

app.get('/api/logo', (req, res) => {
    const db = readDb();
    if (!db.logoDataUrl) return res.status(404).send('No logo');
    const matches = db.logoDataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return res.status(404).send('Invalid logo');
    const buffer = Buffer.from(matches[2], 'base64');
    res.setHeader('Content-Type', matches[1]);
    res.send(buffer);
});

app.put('/api/settings/logo', (req, res) => {
    const { dataUrl } = req.body;
    const db = readDb();
    db.logoDataUrl = dataUrl;
    db.logoVersion = (db.logoVersion || 0) + 1;
    writeDb(db);
    res.json({ success: true, logoVersion: db.logoVersion });
});

app.delete('/api/settings/logo', (req, res) => {
    const db = readDb();
    db.logoDataUrl = null;
    db.logoVersion = (db.logoVersion || 0) + 1;
    writeDb(db);
    res.json({ success: true, logoVersion: db.logoVersion });
});

app.listen(PORT, () => {
    console.log(`Servidor local corriendo en http://localhost:${PORT}`);
});