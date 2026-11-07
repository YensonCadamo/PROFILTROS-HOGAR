const express = require('express');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Configuración e inicialización de WhatsApp Web
const whatsappClient = new Client({
    authStrategy: new LocalAuth()
});

whatsappClient.on('qr', (qr) => {
    console.log('==================================================');
    console.log('Escanea este código QR con el WhatsApp del negocio:');
    console.log('==================================================');
    qrcode.generate(qr, { small: true });
});

whatsappClient.on('ready', () => {
    console.log('¡WhatsApp conectado y listo para enviar mensajes automáticos!');
});

whatsappClient.initialize();

const defaultDb = {
    master: 'admin',
    users: [
        { username: 'elias', password: '123' }
    ],
    clients: [],
    records: [],
    receivables: [],
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
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        if (!data.receivables) data.receivables = [];
        return data;
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
        receivables: db.receivables || [],
        company: db.company,
        logoVersion: db.logoVersion
    });
});

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

// Cuentas por cobrar (Receivables)
app.put('/api/receivables/:id', (req, res) => {
    const id = req.params.id;
    const recData = req.body;
    const db = readDb();
    if (!db.receivables) db.receivables = [];
    const index = db.receivables.findIndex(r => r.id == id);
    if (index !== -1) {
        db.receivables[index] = recData;
    } else {
        db.receivables.push(recData);
    }
    writeDb(db);
    res.json({ success: true });
});

app.delete('/api/receivables/:id', (req, res) => {
    const id = req.params.id;
    const db = readDb();
    if (!db.receivables) db.receivables = [];
    db.receivables = db.receivables.filter(r => r.id != id);
    writeDb(db);
    res.json({ success: true });
});

// Envío de correo electrónico
app.post('/api/receivables/send-email', async (req, res) => {
    const { to, clientName, concept, amountUsd, dueDate, companyName } = req.body;
    if (!to) {
        return res.status(400).json({ error: 'El cliente no tiene un correo electrónico configurado.' });
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.SMTP_USER || 'tu-correo@gmail.com',
            pass: process.env.SMTP_PASS || 'tu-contraseña-de-aplicacion'
        }
    });

    const mailOptions = {
        from: `"${companyName || 'Profiltros Hogar, C.A.'}" <${process.env.SMTP_USER || 'tu-correo@gmail.com'}>`,
        to: to,
        subject: `Recordatorio de Pago Pendiente - ${companyName || 'Profiltros Hogar, C.A.'}`,
        text: `Estimado/a ${clientName},\n\nLe escribimos de parte de ${companyName || 'Profiltros Hogar, C.A.'} para recordarle que tiene un saldo pendiente por concepto de "${concept}" por un monto de $${Number(amountUsd).toFixed(2)} USD.\n\nLa fecha límite acordada para su pago es el ${dueDate}.\n\nAgradecemos su pronta cancelación.\n\n¡Gracias!`
    };

    try {
        if (!process.env.SMTP_USER) {
            return res.json({ success: true, message: 'Simulación: Correo guardado/enviado (Configure variables SMTP_USER y SMTP_PASS para envío real).' });
        }
        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: 'Correo enviado exitosamente al cliente.' });
    } catch (error) {
        console.error('Error al enviar correo:', error);
        res.status(500).json({ error: 'No se pudo enviar el correo electrónico. Verifique la configuración SMTP.' });
    }
});

// Envío automático de WhatsApp
app.post('/api/receivables/send-whatsapp', async (req, res) => {
    const { phone, clientName, concept, amountUsd, dueDate, companyName } = req.body;
    if (!phone) {
        return res.status(400).json({ error: 'El cliente no tiene un número de teléfono registrado.' });
    }

    try {
        let cleanPhone = phone.replace(/\D/g, '');
        if (!cleanPhone.startsWith('58') && cleanPhone.length === 10) {
            cleanPhone = '58' + cleanPhone; // Ajuste automático para código de área local (Venezuela +58)
        }
        const chatId = `${cleanPhone}@c.us`;

        const message = `¡Hola *${clientName}*! 👋\n\nLe escribimos de parte de *${companyName || 'Profiltros Hogar, C.A.'}* para recordarle su saldo pendiente:\n\n📌 *Concepto:* ${concept}\n💰 *Monto:* $${Number(amountUsd).toFixed(2)} USD\n📅 *Fecha límite:* ${dueDate}\n\nAgradecemos su pronta cancelación. ¡Muchas gracias! 🙏`;

        await whatsappClient.sendMessage(chatId, message);
        res.json({ success: true, message: 'Mensaje de WhatsApp enviado exitosamente.' });
    } catch (error) {
        console.error('Error al enviar WhatsApp:', error);
        res.status(500).json({ error: 'No se pudo enviar el mensaje por WhatsApp. Asegúrate de que el servidor esté vinculado escaneando el código QR en la terminal.' });
    }
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