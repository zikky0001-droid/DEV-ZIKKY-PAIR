import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { 
    makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    makeCacheableSignalKeyStore, 
    Browsers, 
    jidNormalizedUser, 
    fetchLatestBaileysVersion, 
    DisconnectReason 
} from '@whiskeysockets/baileys';

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
    let num = req.query.number;
    
    if (!num) {
        return res.status(400).send({ 
            code: 'Phone number is required. Example: 2348054483474 (no + sign)' 
        });
    }

    // Clean the phone number
    num = num.replace(/[^0-9]/g, '');

    if (!num || num.length < 10) {
        return res.status(400).send({ 
            code: 'Invalid phone number. Minimum 10 digits required.' 
        });
    }

    // Create unique session
    const sessionId = `pair_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const dirs = `./pair_sessions/${sessionId}`;

    async function initiateSession() {
        removeFile(dirs);

        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();
            
            // **BAILEYS V7 CRITICAL CONFIGURATION**
            const socketConfig = {
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }).child({ level: "silent" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
                browser: Browsers.windows('Chrome'),
                
                // **V7 SPECIFIC SETTINGS**
                markOnlineOnConnect: true, // Changed from false
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 30000,
                keepAliveIntervalMs: 10000,
                retryRequestDelayMs: 1000,
                maxRetries: 5,
                
                // **NEW IN V7 - THESE ARE CRITICAL**
                emitOwnEvents: true,
                fireInitQueries: true,
                mobile: false,
                syncFullHistory: false,
                linkPreviewImageThumbnailWidth: 192,
                
                // **CONNECTION OPTIMIZATIONS**
                transactionOpts: {
                    maxCommitRetries: 3,
                    delayBetweenTriesMs: 1000
                },
                
                // **WEBSOCKET SETTINGS**
                ws: {
                    agent: false
                }
            };

            console.log('🔧 Creating Baileys v7 socket...');
            let DEVZIKKY = makeWASocket(socketConfig);
            
            let pairCodeSent = false;
            let connectionEstablished = false;
            
            // **V7 CONNECTION EVENT HANDLER**
            DEVZIKKY.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr, isNewLogin, receivedPendingNotifications } = update;
                
                console.log(`🔄 Connection update:`, {
                    connection,
                    isNewLogin,
                    hasPendingNotifications: !!receivedPendingNotifications
                });

                // **V7 CONNECTION OPEN HANDLING**
                if (connection === 'open') {
                    connectionEstablished = true;
                    console.log("✅ Connected successfully!");
                    
                    try {
                        await delay(1000);
                        
                        const sessionPath = dirs + '/creds.json';
                        if (!fs.existsSync(sessionPath)) {
                            console.log("❌ Session file not found");
                            return;
                        }
                        
                        const sessionData = fs.readFileSync(sessionPath);
                        const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                        
                        // Send session file
                        await DEVZIKKY.sendMessage(userJid, {
                            document: sessionData,
                            mimetype: 'application/json',
                            fileName: 'creds.json'
                        });
                        console.log("📄 Session file sent");

                        // Send warning
                        await DEVZIKKY.sendMessage(userJid, {
                            text: `⚠️ *SECURITY WARNING* ⚠️\n\nDO NOT SHARE this file!\n\n┌───────────────┐\n│ DEV•ZIKKY MD  │\n│   © 2026      │\n└───────────────┘`
                        });
                        console.log("⚠️ Warning sent");

                        // Cleanup
                        setTimeout(() => {
                            removeFile(dirs);
                            console.log("✅ Session cleaned");
                        }, 3000);
                        
                    } catch (error) {
                        console.error("❌ Error:", error.message);
                        removeFile(dirs);
                    }
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    console.log('❌ Connection closed', { statusCode });
                    
                    if (statusCode === DisconnectReason.loggedOut) {
                        removeFile(dirs);
                    }
                }
            });

            // **V7 CREDENTIALS UPDATE**
            DEVZIKKY.ev.on('creds.update', saveCreds);

            // **V7 PAIRING CODE REQUEST - FIXED FOR V7**
            if (!DEVZIKKY.authState.creds.registered) {
                console.log("🔐 Requesting pairing code for:", num);
                
                // Wait for socket to initialize
                await delay(2000);
                
                try {
                    // **V7 METHOD - This is different from v6!**
                    let pairingResult;
                    
                    // Try different approaches for v7
                    try {
                        // Method 1: Standard v7 approach
                        pairingResult = await DEVZIKKY.requestPairingCode(num);
                    } catch (e1) {
                        console.log("Method 1 failed:", e1.message);
                        
                        // Method 2: Alternative v7 approach
                        try {
                            pairingResult = await DEVZIKKY.requestPairingCode(num, {
                                phoneNumber: num,
                                pushName: 'DEVZIKKY Bot'
                            });
                        } catch (e2) {
                            console.log("Method 2 failed:", e2.message);
                            throw e2;
                        }
                    }
                    
                    // Extract code from result (v7 returns object)
                    let code;
                    if (typeof pairingResult === 'string') {
                        code = pairingResult;
                    } else if (pairingResult && typeof pairingResult === 'object') {
                        code = pairingResult.code || pairingResult.pairingCode || pairingResult.pairing_code;
                    }
                    
                    if (!code) {
                        throw new Error('No pairing code received');
                    }
                    
                    // Format code
                    const formattedCode = code.toString().length === 6 
                        ? `${code.toString().substring(0, 4)}-${code.toString().substring(4)}`
                        : code.toString();
                    
                    if (!res.headersSent) {
                        pairCodeSent = true;
                        console.log(`✅ Pair code generated: ${formattedCode}`);
                        await res.send({ 
                            code: formattedCode,
                            message: 'Enter this code in WhatsApp → Settings → Linked Devices'
                        });
                    }
                    
                } catch (error) {
                    console.error('❌ Pairing error:', error.message);
                    
                    let errorMessage = 'Failed to get pairing code. ';
                    if (error.message?.includes('rate')) {
                        errorMessage += 'Rate limit. Wait 5 minutes.';
                    } else if (error.message?.includes('already')) {
                        errorMessage += 'Number already registered.';
                    } else {
                        errorMessage += 'Try again.';
                    }
                    
                    if (!res.headersSent) {
                        res.status(503).send({ code: errorMessage });
                    }
                    removeFile(dirs);
                }
            } else {
                console.log("✅ Already registered");
                if (!res.headersSent) {
                    res.status(200).send({ 
                        code: 'Already registered. Try different number.' 
                    });
                }
            }

        } catch (err) {
            console.error('❌ Session error:', err.message);
            if (!res.headersSent) {
                res.status(503).send({ 
                    code: 'Service unavailable. Try again.' 
                });
            }
            removeFile(dirs);
        }
    }

    await initiateSession();
});

// Error handlers
process.on('uncaughtException', (err) => {
    if (!err.message?.includes('ECONN')) {
        console.log('❌ Uncaught:', err.message);
    }
});

process.on('unhandledRejection', (reason) => {
    console.log('❌ Unhandled rejection:', reason?.message);
});

export default router;