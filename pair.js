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
        return res.status(400).send({ 
            code: 'Invalid phone number. Please enter your full international number (e.g., 15551234567 for US, 447911123456 for UK, 2348054483474 for Nigeria, etc.) without + or spaces.' 
        });
    }
    
    // Use the international number format (E.164, without '+')
    num = phone.getNumber('e164').replace('+', '');
    
    // Create session directory
    const sessionId = `pair_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const dirs = `./pair_sessions/${sessionId}`;

    async function initiateSession() {
        // Remove existing session if present
        removeFile(dirs);

        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();
            
            // Baileys v7 Socket Configuration
            const socketConfig = {
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "silent" }).child({ level: "silent" }),
                browser: Browsers.windows('Chrome'),
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
                syncFullHistory: false,
            };

            let DEVZIKKY = makeWASocket(socketConfig);
            
            // Set timeout to prevent hanging
            let pairCodeSent = false;
            let connectionEstablished = false;
            const cleanupTimeout = setTimeout(() => {
                if (!connectionEstablished && !pairCodeSent) {
                    console.log('⏰ Session timeout - cleaning up');
                    if (!res.headersSent) {
                        res.status(408).send({ 
                            code: 'Connection timeout. Please try again.' 
                        });
                    }
                    removeFile(dirs);
                }
            }, 120000); // 2 minutes timeout

            DEVZIKKY.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr, isNewLogin } = update;
                
                console.log(`🔄 Connection update: ${connection || 'undefined'}`);

                if (connection === 'open') {
                    connectionEstablished = true;
                    clearTimeout(cleanupTimeout);
                    
                    console.log("✅ Connected successfully!");
                    
                    try {
                        // Wait for credentials to be saved
                        await delay(2000);
                        
                        const sessionPath = dirs + '/creds.json';
                        if (!fs.existsSync(sessionPath)) {
                            console.log("❌ Session file not found at:", sessionPath);
                            return;
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
                        
                    } catch (error) {
                        console.error("❌ Error sending messages:", error);
                        removeFile(dirs);
                    }
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    console.log('❌ Connection closed', { statusCode });

                    if (statusCode === DisconnectReason.loggedOut) {
                        console.log("🔐 Logged out from WhatsApp");
                        removeFile(dirs);
                    }
                }

                if (isNewLogin) {
                    console.log("🔐 New login via pair code");
                }
            });

            // Handle credentials updates
            DEVZIKKY.ev.on('creds.update', saveCreds);

            // Request pairing code - Baileys v7 specific
            if (!DEVZIKKY.authState.creds.registered) {
                console.log("🔐 Requesting pairing code for:", num);
                
                try {
                    // Wait for socket to be ready
                    await delay(2000);
                    
                    // For Baileys v7, the method might be different
                    let code;
                    
                    try {
                        // Try the standard method
                        code = await DEVZIKKY.requestPairingCode(num);
                    } catch (pairError) {
                        console.log("⚠️ Standard pairing failed, trying alternative...");
                        
                        // Alternative approach for v7
                        if (DEVZIKKY.user) {
                            // Try to get pairing code from connection
                            const pairingInfo = await DEVZIKKY.requestPairingCode(num, {
                                phoneNumber: num,
                                pushName: 'DEVZIKKY Bot'
                            });
                            code = pairingInfo?.code || pairingInfo;
                        } else {
                            throw pairError;
                        }
                    }
                    
                    // Handle different response formats
                    if (code && typeof code === 'object') {
                        if (code.code) code = code.code;
                        else if (code.pairingCode) code = code.pairingCode;
                        else if (code.pairing_code) code = code.pairing_code;
                    }
                    
                    // Format code
                    const formattedCode = code ? code.toString().replace(/(\d{4})(?=\d)/g, '$1-') : code;
                    
                    if (!res.headersSent) {
                        pairCodeSent = true;
                        clearTimeout(cleanupTimeout);
                        
                        console.log({ 
                            number: num, 
                            code: formattedCode,
                            rawCode: code 
                        });
                        
                        await res.send({ 
                            code: formattedCode,
                            message: 'Enter this code in WhatsApp Linked Devices'
                        });
                    }
                    
                } catch (error) {
                    console.error('❌ Error requesting pairing code:', error);
                    
                    let errorMessage = 'Failed to get pairing code. ';
                    let statusCode = 503;
                    
                    if (error.message?.includes('rate') || error.message?.includes('wait')) {
                        errorMessage += 'Rate limit exceeded. Please wait a few minutes.';
                        statusCode = 429;
                    } else if (error.message?.includes('invalid') || error.message?.includes('phone')) {
                        errorMessage += 'Invalid phone number.';
                        statusCode = 400;
                    } else if (error.message?.includes('already registered')) {
                        errorMessage = 'This number is already registered. Try with a different number.';
                        statusCode = 400;
                    } else {
                        errorMessage += 'Please check your number and try again.';
                    }
                    
                    if (!res.headersSent) {
                        res.status(statusCode).send({ code: errorMessage });
                    }
                    removeFile(dirs);
                }
            } else {
                console.log("✅ Already registered");
                if (!res.headersSent) {
                    res.status(200).send({ 
                        code: 'Already registered. Try with a different number.' 
                    });
                }
            }

        } catch (err) {
            console.error('❌ Error initializing session:', err);
            if (!res.headersSent) {
                res.status(503).send({ 
                    code: 'Service Unavailable. Please try again.' 
                });
            }
            removeFile(dirs);
        }
    }

    await initiateSession();
});

// Global error handlers
process.on('uncaughtException', (err) => {
    if (err.message?.includes('ECONNREFUSED') || 
        err.message?.includes('ETIMEDOUT') ||
        err.message?.includes('EPIPE') ||
        err.message?.includes('ECONNRESET')) {
        return; // Ignore common network errors
    }
    console.log('❌ Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('❌ Unhandled Rejection at:', promise, 'reason:', reason?.message);
});

export default router;
