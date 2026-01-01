import express from 'express';
import bodyParser from 'body-parser';
import { fileURLToPath } from 'url';
import path from 'path';

// Importing the modules
import pairRouter from './pair.js';
import qrRouter from './qr.js';
import QRCode from 'qrcode';

const app = express();

// Resolve the current directory path in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8000;

import('events').then(events => {
    events.EventEmitter.defaultMaxListeners = 500;
});

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});

app.use('/pair', pairRouter);
app.use('/qr', qrRouter);

app.listen(PORT, () => {
    console.log(`DEV•ZIKKY MD WhatsApp Bot\n\n            ╔═══════════════════════════════╗
    ║       DEV•ZIKKY MD WhatsApp Bot 
    ╚═══════════════════════════════╝
    
    🌐 Server running on: http://${HOST}:${PORT}
    📱 Available at: https://dev-zikky-pair.onrender.com
    
    📊 Social Media:\n\nGitHub: @zikky0001-droid\n\nTikTok: @zikky.com\n\nServer running on http://localhost:${PORT}`);
});

export default app;