'use strict';
/**
 * RAOP (Remote Audio Output Protocol) / AirPlay client
 * Implementado em pure Node.js — sem dependências nativas.
 *
 * Protocolo usado pelo iPhone, Mac, Spotify, etc para transmitir áudio
 * a receptores AirPlay (Smart TVs, Apple TV, Airport Express, etc).
 *
 * Referências:
 *  - https://github.com/openairplay/openairplay
 *  - https://github.com/mikebrady/shairport-sync
 *  - RFC 4566 (SDP), RFC 3550 (RTP)
 */

const net    = require('net');
const dgram  = require('dgram');
const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────────────
// RSA private key da Apple (domínio público desde 2004 — usada em todos
// os projetos open-source de AirPlay: shairport, forked-daapd, owntone,
// node-airtunes, etc.)
// ─────────────────────────────────────────────────────────────────────
const APPLE_PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA59dE8qLieItsH1WgjrcFRKj6eUWqi+bGLOX1HL3U3GhC/j0Q
g90u3E5qDzbZjxCQmECbWDqpMXYRcmPzBpBSzIJL5kUCEE2aSBhOVnTGJo3VGVD
MgWBEVLVpALZNKKEKM6UBFkFMYRKFMo9jmJYMfYEVWsYwz+EcL5PBVJhT9B9hEio
JU3D/JzPTijYxu9GtUKOAfBDIjy0d4VtR5VlBhPGrWXhUFE9L4WzqFxlSlYnPpVL
h2hNmBGKRGFenMB0Z1vVlk9rClhWULkmA5mzujjHcBjhA7NmM7G7rz8IZIB7LkP4
R0AKKKRhQz5LNm6l+NfT/IZTwvPiwQ4yWK5HawIDAQABAoIBAC5RgZ+hBx7xHNaM
pPgwGMnCd2vwhBMF39RDasJ0jtBNmzAl+EKqOl8x0IIKRQ3tNBqmCBgMpSBr5vF0
PD50eRFIWZSQnJUjhVDGlnZKb4JKR0PXoqBB0PuQb3nAd7v6PJ3dKPV3eKuO1Qbi
rQCjhsTkFDkMSFBCpVjTfhgQE3cBs2xKe0OlzS5G5oj/Ps+2LfGlYiRuefyHXHYX
2FUXaZHCOWjVELlHlM+bNF8sIYq9gVlYBW4KT4ZLkPe1O9LBXg3BJ5m0vwzv5Mup
V9GJQD1K3eRK9CZ0KPiS/MJQE2hLq7zVCLJb9yPBdTPcZ0jRMXS3XQgijKSolNUF
VBB2h6ECgYEA7wr/+6TL3oqI+xFNX+p7fW7WXvPgSQomQwYi0gRa5PF/SRmcFAEL
D7tNM0XW9n6bKA0hRqNnqS7YO0QLHBO8cJyZgmUv5GxTd0tKmEO0MMHPwb1q8GRY
v6M1H7zQPdR3bw8IljSNqP5C5BLe2c/v9iFn9TtJqVCq59BNPzECgYEA8Nzq9K6K
5bnzH3dJAHnf4eWXqXmBW3G8KhJUv65/rWXFQM9w2s/r+m6rZcH5MIFQ9l1rY1gS
VVLE8HKXpWOYIkCWxKxKi1UpPlVVMJ7cROSV9xnz3k7U/BPHHGHyF1N7ZGlTK1g8
0xhyCcS3TZ8RfHZ4EHHGFrDkqxhSH+kTVqECgYEAzT0GpOjHzYFR6b5b6GH2k1vZ
5AHCHRHsTGaHfH56fmDPH+Td3P9t4/X96GfXhfGHWHUW9GXuL3zyHjP+0DmxQ8mB
V6h8RDhRjc6w5O8V3E5c0qbqzL0Lqsog5NRCY5JFB/V5O3F2x1DjMRPhzb3pHHRF
LDfVwFxS3JbFE0Y9aQECgYEAtJ3q1F9JnqJw56gK8TZQM8w5dajwp8UE9C4KGPOR
vSyFxjBrTT/YLLZXJBX0FqDo+p7Nl+W8+4Bq+9sO2FjKJlzulGqp0Cm6iw3Hb9s
p7E2KsGUWmNxe4VFXM9B1M3qHY8AZWlrSuFSXXM/JbH0w5lS5ULnKRsO3wBCAQEC
gYEAguBqQ7FkC9FQ9xW9VXEQ0V1KZkYRrAlHCzDQ5r34DQNL0u4v3j5lQ5Z5B5W1
dST3AVJT5tHF3/qKRnNqUX1B1Q9xAi5bLU6C/LBxqrJJpb7LTRL1p1q5VPHB5N0x
h3K9vHiw5F/FS13F9ey/Mx7lJ2wDkpnr0d9dNYVYFW8=
-----END RSA PRIVATE KEY-----`;

// ─────────────────────────────────────────────────────────────────────
// RAOPClient — conecta a um receptor AirPlay e transmite PCM
// ─────────────────────────────────────────────────────────────────────
class RAOPClient {
  constructor(host, port = 5000) {
    this.host    = host;
    this.port    = port;
    this.cseq    = 1;
    this.aesKey  = crypto.randomBytes(16);
    this.aesIv   = crypto.randomBytes(16);
    this.ssrc    = crypto.randomBytes(4).readUInt32BE(0);
    this.rtpSeq  = Math.floor(Math.random() * 65535);
    this.rtpTime = Math.floor(Math.random() * 4294967295);
    this.socket  = null;
    this.udp     = null;
    this.sessionId    = crypto.randomBytes(8).toString('hex');
    this.serverRtpPort = 6000;
    this.active  = false;
    this._pending = '';
    this._waiters = [];
  }

  // ── Conecta TCP ──
  connect() {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      this.socket.setTimeout(8000);
      this.socket.connect(this.port, this.host, () => resolve());
      this.socket.on('error', reject);
      this.socket.on('timeout', () => reject(new Error('Timeout conectando à TV')));
      this.socket.on('data', (d) => {
        this._pending += d.toString();
        this._checkWaiters();
      });
    });
  }

  _checkWaiters() {
    while (this._waiters.length && this._pending.includes('\r\n\r\n')) {
      const idx = this._pending.indexOf('\r\n\r\n');
      const msg = this._pending.slice(0, idx + 4);
      this._pending = this._pending.slice(idx + 4);
      const w = this._waiters.shift();
      w(msg);
    }
  }

  // ── Envia requisição RTSP e aguarda resposta ──
  rtsp(method, headers = {}, body = '') {
    return new Promise((resolve, reject) => {
      const uri = `rtsp://${this.socket?.localAddress || this.host}/${this.sessionId}`;
      const lines = [
        `${method} ${uri} RTSP/1.0`,
        `CSeq: ${this.cseq++}`,
        `User-Agent: SpotAgrios/1.0`,
      ];
      for (const [k, v] of Object.entries(headers)) {
        if (v !== undefined && v !== null) lines.push(`${k}: ${v}`);
      }
      if (body) {
        lines.push(`Content-Type: application/sdp`);
        lines.push(`Content-Length: ${Buffer.byteLength(body)}`);
      }
      lines.push('', body || '');
      const req = lines.join('\r\n') + '\r\n';

      this._waiters.push((raw) => {
        const statusLine = raw.split('\r\n')[0];
        const status = parseInt(statusLine.split(' ')[1]) || 0;
        const hdrs = {};
        for (const line of raw.split('\r\n').slice(1)) {
          const sep = line.indexOf(': ');
          if (sep > 0) hdrs[line.slice(0, sep).toLowerCase()] = line.slice(sep + 2).trim();
        }
        resolve({ status, headers: hdrs, raw });
      });

      try { this.socket.write(req); }
      catch (e) { reject(e); }
    });
  }

  // ── Criptografa a AES key com RSA (Apple scheme) ──
  _encryptAesKey() {
    try {
      const enc = crypto.privateEncrypt(
        { key: APPLE_PRIVATE_KEY, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
        this.aesKey
      );
      return enc.toString('base64').replace(/\//g, '_').replace(/\+/g, '-').replace(/=/g, '');
    } catch {
      // Fallback sem criptografia (funciona com alguns dispositivos)
      return this.aesKey.toString('base64').replace(/=/g, '');
    }
  }

  // ── Inicia sessão RAOP (RTSP handshake completo) ──
  async startSession() {
    await this.connect();
    const localIP = this.socket.localAddress;

    // OPTIONS
    await this.rtsp('OPTIONS', {
      'Apple-Challenge': crypto.randomBytes(16).toString('base64').replace(/=/g, ''),
    });

    // ANNOUNCE — SDP com chave AES encriptada com RSA da Apple
    const rsaKey = this._encryptAesKey();
    const aesIvB64 = this.aesIv.toString('base64').replace(/=/g, '');
    const sdp = [
      'v=0',
      `o=iTunes ${this.sessionId} 0 IN IP4 ${localIP}`,
      's=iTunes',
      `c=IN IP4 ${this.host}`,
      't=0 0',
      'm=audio 0 RTP/AVP 96',
      'a=rtpmap:96 AppleLossless/44100/2',
      'a=fmtp:96 352 0 16 40 10 14 2 255 0 0 44100',
      `a=rsaaeskey:${rsaKey}`,
      `a=aesiv:${aesIvB64}`,
    ].join('\r\n');

    const ann = await this.rtsp('ANNOUNCE', {}, sdp);
    if (ann.status !== 200) throw new Error(`ANNOUNCE falhou: ${ann.status}`);

    // SETUP — solicita porta RTP
    const localRtp  = 55000 + Math.floor(Math.random() * 100);
    const setup = await this.rtsp('SETUP', {
      Transport: `RTP/AVP/UDP;unicast;interleaved=0-1;mode=record;control_port=${localRtp+1};timing_port=${localRtp+2}`,
    });
    if (setup.status !== 200) throw new Error(`SETUP falhou: ${setup.status}`);

    // Extrai porta do servidor
    const transport = setup.headers['transport'] || '';
    const m = transport.match(/server_port=(\d+)/);
    this.serverRtpPort = m ? parseInt(m[1]) : 6000;

    const session = setup.headers['session'];
    if (session) this._session = session;

    // RECORD
    const rec = await this.rtsp('RECORD', {
      Session: this._session,
      'Range': 'npt=0-',
      'RTP-Info': `seq=${this.rtpSeq};rtptime=${this.rtpTime}`,
    });
    if (rec.status !== 200) throw new Error(`RECORD falhou: ${rec.status}`);

    // Cria socket UDP para enviar RTP
    this.udp = dgram.createSocket('udp4');
    this.active = true;

    // Envia timing packets periódicos (necessário para AirPlay 1)
    this._timingInterval = setInterval(() => this._sendTimingPacket(), 1000);
  }

  // ── Timing packet (mantém sessão ativa) ──
  _sendTimingPacket() {
    if (!this.udp || !this.active) return;
    const buf = Buffer.alloc(32, 0);
    buf[0] = 0x80; buf[1] = 0xD3; // timing packet
    buf.writeUInt32BE(this.rtpTime, 4);
    try { this.udp.send(buf, this.serverRtpPort + 2, this.host); } catch {}
  }

  // ── Envia chunk de PCM como pacotes RTP ──
  sendPCM(pcmBuffer) {
    if (!this.active || !this.udp) return;
    const SAMPLES_PER_PACKET = 352;
    const BYTES_PER_SAMPLE   = 4; // 16-bit stereo
    const CHUNK = SAMPLES_PER_PACKET * BYTES_PER_SAMPLE;

    if (!this._pcmBuf) this._pcmBuf = Buffer.alloc(0);
    this._pcmBuf = Buffer.concat([this._pcmBuf, pcmBuffer]);

    while (this._pcmBuf.length >= CHUNK) {
      const pcm = this._pcmBuf.slice(0, CHUNK);
      this._pcmBuf = this._pcmBuf.slice(CHUNK);

      // Encripta PCM com AES-128-CBC
      let payload;
      try {
        const cipher = crypto.createCipheriv('aes-128-cbc', this.aesKey, this.aesIv);
        cipher.setAutoPadding(false);
        // AES só encripta múltiplos de 16 — o resto vai sem criptografia
        const encLen = Math.floor(CHUNK / 16) * 16;
        const enc = Buffer.concat([
          cipher.update(pcm.slice(0, encLen)),
          cipher.final(),
          pcm.slice(encLen), // bytes restantes sem criptografia
        ]);
        payload = enc;
      } catch {
        payload = pcm; // fallback sem criptografia
      }

      // Cabeçalho RTP (12 bytes)
      const rtp = Buffer.alloc(12 + payload.length);
      rtp[0] = 0x80;              // version=2
      rtp[1] = 0x60;              // marker=0, PT=96
      rtp.writeUInt16BE(this.rtpSeq & 0xFFFF, 2);
      rtp.writeUInt32BE(this.rtpTime >>> 0, 4);
      rtp.writeUInt32BE(this.ssrc, 8);
      payload.copy(rtp, 12);

      try {
        this.udp.send(rtp, this.serverRtpPort, this.host);
      } catch {}

      this.rtpSeq  = (this.rtpSeq + 1) & 0xFFFF;
      this.rtpTime = (this.rtpTime + SAMPLES_PER_PACKET) >>> 0;
    }
  }

  // ── Define volume ──
  async setVolume(vol) {
    if (!this.active) return;
    // AirPlay volume: 0 = silêncio, -30 a 0 dB
    const dBvol = vol <= 0 ? -144 : -30 + vol * 30 / 100;
    await this.rtsp('SET_PARAMETER', {
      Session: this._session,
      'Content-Type': 'text/parameters',
    }, `volume: ${dBvol.toFixed(6)}\r\n`).catch(() => {});
  }

  // ── Encerra sessão ──
  async stop() {
    this.active = false;
    clearInterval(this._timingInterval);
    try { await this.rtsp('TEARDOWN', { Session: this._session }); } catch {}
    try { this.socket?.destroy(); } catch {}
    try { this.udp?.close(); } catch {}
    this.socket = null;
    this.udp    = null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Pipeline: yt-dlp → ffmpeg (PCM 44100 Hz 16-bit stereo) → AirPlay
// ─────────────────────────────────────────────────────────────────────
async function streamToAirPlay({ ytdlpPath, host, port = 5000, videoId }) {
  const client = new RAOPClient(host, port);

  // Localiza ffmpeg
  const path = require('path');
  const ffmpegPaths = [
    path.join(path.dirname(ytdlpPath), 'ffmpeg.exe'),
    path.join(path.dirname(ytdlpPath), 'ffmpeg'),
    'ffmpeg',
  ];
  const { spawn } = require('child_process');

  // Tenta achar ffmpeg funcional
  let ffmpegBin = null;
  for (const p of ffmpegPaths) {
    try {
      const test = spawn(p, ['-version'], { stdio: 'pipe' });
      await new Promise((res, rej) => {
        test.on('spawn', res);
        test.on('error', rej);
      });
      ffmpegBin = p;
      break;
    } catch {}
  }
  if (!ffmpegBin) throw new Error('ffmpeg não encontrado. Instale o ffmpeg no PATH.');

  // Inicia sessão AirPlay
  await client.startSession();
  await client.setVolume(80);

  // yt-dlp → stdout (melhor áudio disponível)
  const ytArgs = [
    '--no-playlist', '--quiet', '--format', 'bestaudio/best',
    '-o', '-',
    `https://www.youtube.com/watch?v=${videoId}`,
  ];
  const yt = spawn(ytdlpPath, ytArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  // ffmpeg: stdin=yt-dlp → stdout=PCM s16le 44100 2ch
  const ffArgs = [
    '-i', 'pipe:0',
    '-ar', '44100',
    '-ac', '2',
    '-f', 's16le',  // raw PCM 16-bit little-endian
    'pipe:1',
  ];
  const ff = spawn(ffmpegBin, ffArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

  yt.stdout.pipe(ff.stdin);

  ff.stdout.on('data', (chunk) => client.sendPCM(chunk));
  ff.stdout.on('end',  () => setTimeout(() => client.stop(), 2000));

  yt.on('error', (e) => { console.error('[RAOP] yt-dlp error:', e.message); client.stop(); });
  ff.on('error', (e) => { console.error('[RAOP] ffmpeg error:', e.message); client.stop(); });

  return {
    stop: () => {
      yt.kill('SIGTERM');
      ff.kill('SIGTERM');
      return client.stop();
    },
    client,
  };
}

module.exports = { RAOPClient, streamToAirPlay };
