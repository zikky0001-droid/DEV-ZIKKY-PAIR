import express from 'express';
import bodyParser from 'body-parser';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

// Importing the modules
import pairRouter from './pair.js';
import qrRouter from './qr.js';

const app = express();

// Resolve the current directory path in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Render requires 0.0.0.0 binding
const PORT = process.env.PORT || 8000;
const HOST = '0.0.0.0';

// Increase event listeners for Baileys v7
import('events').then(events => {
    events.EventEmitter.defaultMaxListeners = 1000;
});

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Create session directories
const sessionDirs = ['./pair_sessions', './qr_sessions'];
sessionDirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});

// Health check endpoint (important for Render)
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.use('/pair', pairRouter);
app.use('/qr', qrRouter);

// Start server with proper binding
const server = app.listen(PORT, HOST, () => {
    console.log(`
    ╔═══════════════════════════════╗
    ║       DEV•ZIKKY MD WhatsApp Bot 
    ╚═══════════════════════════════╝
    
    🌐 Server running on: http://${HOST}:${PORT}
    📱 Available at: https://dev-zikky-pair.onrender.com
    
    📊 Social Media:
    • TikTok: @zikky.com
    • GitHub: @zikky0001-droid
    • Telegram: @Zikkystar1
    `);
});

// Increase timeout for WhatsApp connections
server.setTimeout(120000); // 2 minutes
server.keepAliveTimeout = 65000;

export default app;