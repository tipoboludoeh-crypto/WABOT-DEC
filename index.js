import { 
    makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    delay, 
    Browsers  
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import qrcode from 'qrcode-terminal';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class WhatsAppBot {
    constructor() {
        this.sock = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 15000;
    }

    async start() {
        try {
            const { state, saveCreds } = await useMultiFileAuthState(join(__dirname, 'session'));

            this.sock = makeWASocket({
                logger: pino({ level: 'silent' }),
                printQRInTerminal: false,
                auth: state,
                markOnlineOnConnect: false,
                syncFullHistory: false,
                generateHighQualityLinkPreview: false,

                browser: Browsers.macOS('Safari'),

                version: [2, 3000, 1027934701],
            });

            this.setupEventHandlers(saveCreds);
        } catch (error) {
            console.error('Error al iniciar el bot:', error);
            this.reconnect();
        }
    }

    setupEventHandlers(saveCreds) {
        const sock = this.sock;

        sock.ev.on('qr', (qr) => {
            console.clear();
            console.log('📱 Escanea este QR con tu WhatsApp:');
            qrcode.generate(qr, { small: true });
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                this.reconnectAttempts = 0;
                console.clear();

                console.log('✅ ¡Bot conectado exitosamente!');
                console.log(`👤 Conectado como: ${sock.user?.name || 'Usuario'} (${sock.user?.id || 'cargando...'})`);
                console.log(`🕐 Hora de conexión: ${new Date().toLocaleString('es-ES')}`);
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

                // ← FIX AQUÍ: Extraemos solo el número puro (sin :2 ni nada)
                let attempts = 0;
                while (!sock.user?.id && attempts < 20) {
                    await delay(500);
                    attempts++;
                }

                if (sock.user?.id) {
                    // Quitamos todo después del : para obtener "593967729399@s.whatsapp.net"
                    const myNumberJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

                    try {
                        await sock.sendMessage(myNumberJid, {
                            text: `🤖 *¡Bot conectado exitosamente!*\n\n🕐 ${new Date().toLocaleString('es-ES')}\n✅ Todo funcionando correctamente.`
                        });
                        console.log('📱 Mensaje de confirmación enviado correctamente a tu número.');
                    } catch (e) {
                        console.log('⚠️ Error enviando el mensaje (raro, pero a veces pasa):', e.message);
                    }
                } else {
                    console.log('⚠️ No se pudo obtener tu ID. Mensaje no enviado.');
                }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                if (statusCode === DisconnectReason.loggedOut) {
                    console.log('🔒 Sesión cerrada manualmente. Borra la carpeta "session" para volver a conectar.');
                    process.exit(0);
                } else {
                    console.log(`⚠️ Conexión perdida (código: ${statusCode || 'desconocido'}). Reconectando en 15 segundos...`);
                    this.reconnect();
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // Fallback pairing code (lo dejamos)
        sock.ev.on('connection.update', async (update) => {
            if (update.connection === 'connecting' && !sock.authState.creds.registered) {
                console.log('\n🔢 Generando código de vinculación...');
                const phoneNumber = await this.askForPhoneNumber();
                if (phoneNumber) {
                    try {
                        const code = await sock.requestPairingCode(phoneNumber);
                        console.clear();
                        console.log(`📩 Código de vinculación:\n\n     *${code}*\n`);
                        console.log(`📱 Ve a WhatsApp > Dispositivos vinculados > Vincular con código`);
                    } catch (err) {
                        console.log('❌ Error con el código:', err.message);
                    }
                }
            }
        });
    }

    async askForPhoneNumber() {
        const { createInterface } = await import('readline');
        const readline = createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            readline.question('\n📱 Número internacional (ej: 593967729399): ', (answer) => {
                readline.close();
                const cleaned = answer.replace(/[^\d]/g, '');
                if (cleaned.length >= 10 && cleaned.length <= 15) {
                    console.log(`✅ Número aceptado: ${cleaned}`);
                    resolve(cleaned);
                } else {
                    console.log('❌ Número inválido.');
                    resolve(null);
                }
            });
        });
    }

    reconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('❌ Límite de reconexiones alcanzado. Borra "session" y vuelve a empezar.');
            process.exit(1);
        }
        this.reconnectAttempts++;
        console.log(`⏳ Reconectando... intento ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
        setTimeout(() => this.start(), this.reconnectDelay);
    }
}

['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach(signal => {
    process.on(signal, () => {
        console.log(`\n🛑 Bot detenido manualmente (${signal})`);
        process.exit(0);
    });
});

const bot = new WhatsAppBot();
bot.start();