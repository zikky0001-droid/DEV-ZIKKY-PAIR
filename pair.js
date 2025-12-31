import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

const router = express.Router();

// Function to remove files or directories
function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
        return true;
    } catch (e) {
        console.error('Error removing file:', e);
        return false;
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    
    // Clean the phone number - remove any non-digit characters
    num = num.replace(/[^0-9]/g, '');

    // Validate the phone number using awesome-phonenumber
    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ 
                code: 'Invalid phone number. Please enter your full international number without + or spaces.\n\nExamples:\n• US: 15551234567\n• UK: 447911123456\n• Nigeria: 2348054483474'
            });
        }
        return;
    }
    // Use the international number format (E.164, without '+')
    num = phone.getNumber('e164').replace('+', '');
    
    // Create unique session directory for each request
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const dirs = `./pair_sessions/${sessionId}`;

    // Ensure pair_sessions directory exists
    if (!fs.existsSync('./pair_sessions')) {
        fs.mkdirSync('./pair_sessions', { recursive: true });
    }

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version, isLatest } = await fetchLatestBaileysVersion();
            let DEVZIKKY = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.windows('Chrome'),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            });

            let pairCodeSent = false;
            let sessionSent = false;
            const maxWaitTime = 60000; // 60 seconds timeout

            // Set timeout to clean up if process takes too long
            const cleanupTimeout = setTimeout(() => {
                if (!sessionSent) {
                    console.log("⏰ Session timeout - cleaning up...");
                    removeFile(dirs);
                }
            }, maxWaitTime);

            DEVZIKKY.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === 'open') {
                    console.log("✅ Connected successfully!");
                    console.log("📱 Sending session file to user...");
                    
                    try {
                        // Read session file
                        const sessionPath = `${dirs}/creds.json`;
                        if (!fs.existsSync(sessionPath)) {
                            throw new Error("Session file not found");
                        }
                        
                        const sessionData = fs.readFileSync(sessionPath);
                        const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                        
                        // Send session file
                        await DEVZIKKY.sendMessage(userJid, {
                            document: sessionData,
                            mimetype: 'application/json',
                            fileName: 'creds.json'
                        });
                        console.log("📄 Session file sent successfully");

                        // Send warning message
                        await DEVZIKKY.sendMessage(userJid, {
                            text: `⚠️ *IMPORTANT SECURITY WARNING* ⚠️

🚫 **DO NOT SHARE** this file with ANYONE
🔒 This file gives FULL ACCESS to your WhatsApp account
💾 Keep it in a SECURE location
🛡️ If compromised, immediately unlink all devices in WhatsApp

📝 **To use this session file:**
1. Save 'creds.json' securely
2. Use it with your WhatsApp bot
3. Never share it online

┌───────────────┐
│ DEV•ZIKKY MD  │
│   © 2025      │
└───────────────┘`
                        });
                        console.log("⚠️ Warning message sent successfully");

                        sessionSent = true;
                        
                        // Clean up session after sending
                        console.log("🧹 Cleaning up session...");
                        setTimeout(() => {
                            removeFile(dirs);
                            console.log("✅ Session cleaned up successfully");
                        }, 5000);

                        // Close connection gracefully
                        setTimeout(() => {
                            if (DEVZIKKY.ws && DEVZIKKY.ws.readyState === 1) {
                                DEVZIKKY.ws.close();
                            }
                        }, 3000);

                    } catch (error) {
                        console.error("❌ Error sending messages:", error);
                        removeFile(dirs);
                    } finally {
                        clearTimeout(cleanupTimeout);
                    }
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    
                    if (statusCode === 401) {
                        console.log("❌ Logged out from WhatsApp. Need to generate new pair code.");
                        if (!pairCodeSent && !res.headersSent) {
                            res.status(401).send({ code: 'Session expired. Please try again.' });
                        }
                    } else if (!sessionSent) {
                        console.log("🔁 Connection closed unexpectedly");
                    }
                }
            });

            if (!DEVZIKKY.authState.creds.registered) {
                await delay(3000);
                
                try {
                    let code = await DEVZIKKY.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    
                    if (!res.headersSent) {
                        pairCodeSent = true;
                        console.log(`📱 Pair code generated for ${num}: ${code}`);
                        await res.send({ code });
                    }
                } catch (error) {
                    console.error('❌ Error requesting pairing code:', error);
                    if (!res.headersSent) {
                        res.status(503).send({ code: 'Failed to get pairing code. Please check your phone number and try again.' });
                    }
                    removeFile(dirs);
                }
            }

            DEVZIKKY.ev.on('creds.update', saveCreds);

        } catch (err) {
            console.error('❌ Error initializing session:', err);
            if (!res.headersSent) {
                res.status(503).send({ code: 'Service Unavailable' });
            }
            removeFile(dirs);
        }
    }

    await initiateSession();
});

// Global uncaught exception handler
process.on('uncaughtException', (err) => {
    let e = String(err);
    if (e.includes("conflict")) return;
    if (e.includes("not-authorized")) return;
    if (e.includes("Socket connection timeout")) return;
    if (e.includes("rate-overlimit")) return;
    if (e.includes("Connection Closed")) return;
    if (e.includes("Timed Out")) return;
    if (e.includes("Value not found")) return;
    if (e.includes("Stream Errored")) return;
    if (e.includes("Stream Errored (restart required)")) return;
    if (e.includes("statusCode: 515")) return;
    if (e.includes("statusCode: 503")) return;
    console.log('Caught exception: ', err);
});

export default router;