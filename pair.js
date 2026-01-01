import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion, DisconnectReason } from '@whiskeysockets/baileys';
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
    const sessionId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const dirs = `./pair_sessions/session_${sessionId}`;

    // Ensure directory exists
    if (!fs.existsSync('./pair_sessions')) {
        fs.mkdirSync('./pair_sessions', { recursive: true });
    }

    async function initiateSession() {
        // Remove existing session if present
        removeFile(dirs);

        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version, isLatest } = await fetchLatestBaileysVersion();
            
            // Baileys v7 Socket Configuration
            const socketConfig = {
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
                keepAliveIntervalMs: 10000,
                retryRequestDelayMs: 250,
                maxRetries: 10,
                emitOwnEvents: true,
                fireInitQueries: true,
                mobile: false,
                syncFullHistory: false,
                transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },
            };

            let DEVZIKKY = makeWASocket(socketConfig);
            
            // Set timeout to prevent hanging
            let pairCodeSent = false;
            let connectionEstablished = false;
            const timeoutDuration = 120000; // 2 minutes timeout
            
            const cleanupTimeout = setTimeout(() => {
                if (!connectionEstablished && !res.headersSent) {
                    console.log('⏰ Session timeout - cleaning up');
                    res.status(408).send({ 
                        code: 'Connection timeout. Please try again.' 
                    });
                    removeFile(dirs);
                }
            }, timeoutDuration);

            DEVZIKKY.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr, isNewLogin, receivedPendingNotifications } = update;
                console.log(`🔄 Connection update:`, {
                    connection,
                    qr: qr ? 'QR Received' : 'No QR',
                    isNewLogin,
                    hasPendingNotifications: !!receivedPendingNotifications
                });

                if (connection === 'open') {
                    connectionEstablished = true;
                    clearTimeout(cleanupTimeout);
                    
                    console.log("✅ Connected successfully!");
                    console.log("📱 Sending session file to user...");
                    
                    try {
                        // Wait a moment to ensure session is saved
                        await delay(1500);
                        
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
│   © 2026      │
└───────────────┘`
                        });
                        console.log("⚠️ Warning message sent successfully");

                        // Clean up session after use
                        console.log("🧹 Cleaning up session...");
                        setTimeout(() => {
                            removeFile(dirs);
                            console.log("✅ Session cleaned up successfully");
                        }, 5000);
                        
                        // Gracefully close connection after sending files
                        setTimeout(async () => {
                            try {
                                await DEVZIKKY.end(undefined);
                            } catch (e) {
                                console.log('Clean closure completed');
                            }
                        }, 3000);
                        
                    } catch (error) {
                        console.error("❌ Error sending messages:", error);
                        removeFile(dirs);
                    }
                }

                if (connection === 'close') {
                    const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
                    console.log('❌ Connection closed', {
                        statusCode: lastDisconnect?.error?.output?.statusCode,
                        shouldReconnect
                    });

                    if (lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut) {
                        console.log("🔐 Logged out from WhatsApp. Need to generate new pair code.");
                        removeFile(dirs);
                    }
                }

                if (isNewLogin) {
                    console.log("🔐 New login via pair code detected");
                }
            });

            // Handle credentials updates
            DEVZIKKY.ev.on('creds.update', saveCreds);

            // Request pairing code
            if (!DEVZIKKY.authState.creds.registered) {
                await delay(3000);
                
                try {
                    // For Baileys v7, requestPairingCode might have different signature
                    let code = await DEVZIKKY.requestPairingCode(num);
                    
                    // Handle different response formats
                    if (typeof code === 'object' && code.code) {
                        code = code.code;
                    }
                    
                    // Format code with dashes (XXXX-XX format)
                    const formattedCode = code?.toString().match(/.{1,4}/g)?.join('-') || code;
                    
                    if (!res.headersSent) {
                        pairCodeSent = true;
                        console.log({ 
                            number: num, 
                            code: formattedCode,
                            rawCode: code 
                        });
                        await res.send({ code: formattedCode });
                    }
                } catch (error) {
                    console.error('❌ Error requesting pairing code:', error);
                    
                    let errorMessage = 'Failed to get pairing code. Please check your phone number and try again.';
                    let statusCode = 503;
                    
                    if (error.message?.includes('rate') || error.message?.includes('wait')) {
                        errorMessage = 'Rate limit exceeded. Please wait a few minutes before trying again.';
                        statusCode = 429;
                    } else if (error.message?.includes('invalid') || error.message?.includes('phone')) {
                        errorMessage = 'Invalid phone number format. Please check and try again.';
                        statusCode = 400;
                    }
                    
                    if (!res.headersSent) {
                        res.status(statusCode).send({ code: errorMessage });
                    }
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

        } catch (err) {
            console.error('❌ Error initializing session:', err);
            if (!res.headersSent) {
                res.status(503).send({ 
                    code: 'Service Unavailable. Please try again in a few moments.' 
                });
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
    console.log('❌ Caught exception: ', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

export default router;
