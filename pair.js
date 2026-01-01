import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

const router = express.Router();

// Ensure the session directory exists
function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    
    if (!num) {
        return res.status(400).send({ 
            code: 'Phone number is required. Please enter your full international number (e.g., 15551234567 for US, 447911123456 for UK, 2348054483474 for Nigeria, etc.) without + or spaces.' 
        });
    }

    // Clean the phone number - remove any non-digit characters
    num = num.replace(/[^0-9]/g, '');

    // Validate the phone number using awesome-phonenumber
    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ 
                code: 'Invalid phone number. Please enter your full international number (e.g., 15551234567 for US, 447911123456 for UK, 2348054483474 for Nigeria, etc.) without + or spaces.' 
            });
        }
        return;
    }
    // Use the international number format (E.164, without '+')
    num = phone.getNumber('e164').replace('+', '');
    
    // Create session directory
    const dirs = `./session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    async function initiateSession() {
        // Remove existing session if present
        removeFile(dirs);

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

            DEVZIKKY.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, isNewLogin, isOnline } = update;

                if (connection === 'open') {
                    console.log("✅ Connected successfully!");
                    console.log("📱 Sending session file to user...");
                    
                    try {
                        // Wait a moment to ensure session is saved
                        await delay(1000);
                        
                        const sessionPath = dirs + '/creds.json';
                        if (!fs.existsSync(sessionPath)) {
                            throw new Error("Session file not found");
                        }
                        
                        const sessionData = fs.readFileSync(sessionPath);
                        const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                        
                        // Send session file to user
                        await DEVZIKKY.sendMessage(userJid, {
                            document: sessionData,
                            mimetype: 'application/json',
                            fileName: 'creds.json'
                        });
                        console.log("📄 Session file sent successfully");

                        // Send warning message (removed video thumbnail)
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
│   © 2026      │
└───────────────┘`
                        });
                        console.log("⚠️ Warning message sent successfully");

                        // Clean up session after use
                        console.log("🧹 Cleaning up session...");
                        await delay(2000);
                        removeFile(dirs);
                        console.log("✅ Session cleaned up successfully");
                        console.log("🎉 Process completed successfully!");
                        
                    } catch (error) {
                        console.error("❌ Error sending messages:", error);
                        // Still clean up session even if sending fails
                        removeFile(dirs);
                    }
                }

                if (isNewLogin) {
                    console.log("🔐 New login via pair code");
                }

                if (isOnline) {
                    console.log("📶 Client is online");
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;

                    if (statusCode === 401) {
                        console.log("❌ Logged out from WhatsApp. Need to generate new pair code.");
                    } else {
                        console.log("🔁 Connection closed — restarting...");
                        // Don't restart automatically - let user request new code
                    }
                }
            });

            if (!DEVZIKKY.authState.creds.registered) {
                // Wait before requesting pairing code (like original)
                await delay(3000);
                
                // Clean the number again for pairing code request
                let pairingNum = num.replace(/[^\d+]/g, '');
                if (pairingNum.startsWith('+')) pairingNum = pairingNum.substring(1);

                try {
                    let code = await DEVZIKKY.requestPairingCode(pairingNum);
                    // Format code with dashes (XXXX-XX format)
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    
                    if (!res.headersSent) {
                        console.log({ num: pairingNum, code });
                        await res.send({ code });
                    }
                } catch (error) {
                    console.error('Error requesting pairing code:', error);
                    if (!res.headersSent) {
                        res.status(503).send({ 
                            code: 'Failed to get pairing code. Please check your phone number and try again.' 
                        });
                    }
                    // Clean up on error
                    removeFile(dirs);
                }
            } else {
                console.log("✅ Already registered, no need for pair code");
                if (!res.headersSent) {
                    res.status(200).send({ 
                        code: 'Already registered. Please try with a different number or restart the session.' 
                    });
                }
            }

            DEVZIKKY.ev.on('creds.update', saveCreds);

        } catch (err) {
            console.error('Error initializing session:', err);
            if (!res.headersSent) {
                res.status(503).send({ 
                    code: 'Service Unavailable. Please try again in a few moments.' 
                });
            }
            // Clean up on error
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
