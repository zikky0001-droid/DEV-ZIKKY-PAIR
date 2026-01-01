import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion, DisconnectReason } from '@whiskeysockets/baileys';
import { delay } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';

const router = express.Router();

function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

router.get('/', async (req, res) => {
    const sessionId = `qr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const dirs = `./qr_sessions/${sessionId}`;

    async function initiateSession() {
        removeFile(dirs);

        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();
            
            let qrGenerated = false;
            let responseSent = false;

            const socketConfig = {
                version,
                logger: pino({ level: 'silent' }),
                browser: Browsers.windows('Chrome'),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 10000,
                retryRequestDelayMs: 500,
                maxRetries: 3,
                emitOwnEvents: true,
                fireInitQueries: true,
                mobile: false,
            };

            let sock = makeWASocket(socketConfig);

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr && !qrGenerated) {
                    qrGenerated = true;
                    console.log('🟢 QR Code Generated');
                    
                    try {
                        const qrDataURL = await QRCode.toDataURL(qr, {
                            errorCorrectionLevel: 'M',
                            margin: 1,
                            color: {
                                dark: '#000000',
                                light: '#FFFFFF'
                            }
                        });

                        if (!responseSent) {
                            responseSent = true;
                            await res.send({ 
                                qr: qrDataURL, 
                                instructions: [
                                    '1. Open WhatsApp on your phone',
                                    '2. Go to Settings → Linked Devices',
                                    '3. Tap "Link a Device"',
                                    '4. Scan the QR code above',
                                    '5. Wait for verification'
                                ]
                            });
                        }
                    } catch (qrError) {
                        console.error('Error generating QR code:', qrError);
                        if (!responseSent) {
                            responseSent = true;
                            res.status(500).send({ code: 'Failed to generate QR code' });
                        }
                    }
                }

                if (connection === 'open') {
                    console.log('✅ Connected successfully!');
                    
                    try {
                        await delay(2000);
                        
                        const sessionData = fs.readFileSync(dirs + '/creds.json');
                        const userJid = Object.keys(sock.authState.creds.me || {}).length > 0 
                            ? jidNormalizedUser(sock.authState.creds.me.id) 
                            : null;
                            
                        if (userJid) {
                            await sock.sendMessage(userJid, {
                                document: sessionData,
                                mimetype: 'application/json',
                                fileName: 'creds.json'
                            });
                            console.log("📄 Session file sent");
                            
                            await sock.sendMessage(userJid, {
                                text: `⚠️ *IMPORTANT SECURITY WARNING* ⚠️

🚫 **DO NOT SHARE** this file with ANYONE
🔒 This file gives FULL ACCESS to your WhatsApp account
💾 Keep it in a SECURE location

┌───────────────┐
│ DEV•ZIKKY MD  │
│   © 2026      │
└───────────────┘`
                            });
                        }
                    } catch (error) {
                        console.error("Error sending session file:", error);
                    }
                    
                    setTimeout(() => {
                        removeFile(dirs);
                        console.log('✅ Session cleaned up');
                    }, 10000);
                }

                if (connection === 'close') {
                    if (lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut) {
                        removeFile(dirs);
                    }
                }
            });

            sock.ev.on('creds.update', saveCreds);

            setTimeout(() => {
                if (!responseSent) {
                    responseSent = true;
                    res.status(408).send({ code: 'QR generation timeout' });
                    removeFile(dirs);
                }
            }, 30000);

        } catch (err) {
            console.error('Error initializing session:', err);
            if (!res.headersSent) {
                res.status(503).send({ code: 'Service Unavailable' });
            }
            removeFile(dirs);
        }
    }

    await initiateSession();
});

export default router;
