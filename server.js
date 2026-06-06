const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const os       = require('os');
const net      = require('net');
const dgram    = require('dgram');
const { spawn, execFile, exec } = require('child_process');
const { streamToAirPlay } = require('./raop');

const app  = express();
const PORT = process.env.PORT || 3000;
// Cross-platform: yt-dlp.exe no Windows, yt-dlp no Linux/Mac
const YTDLP = path.join(__dirname, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ──────────────────────────────────────────────────────────────
// Helper: roda yt-dlp e captura stdout como string
// ──────────────────────────────────────────────────────────────
function ytdlp(args) {
  return new Promise((resolve, reject) => {
    execFile(YTDLP, args, { maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

// ──────────────────────────────────────────────────────────────
// BUSCA — sem API key, usando play-dl como fallback
// ──────────────────────────────────────────────────────────────
let playdl = null;
(async () => {
  try { playdl = await import('play-dl'); console.log('✅ play-dl carregado'); }
  catch (_) {}
})();

app.get('/api/search', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'q é obrigatório' });

  // 1) play-dl search
  try {
    if (playdl) {
      const results = await playdl.search(q, { source: { youtube: 'video' }, limit: 20 });
      const items = results.map(v => ({
        id:        v.id,
        title:     v.title || 'Sem título',
        channel:   v.channel?.name || 'Desconhecido',
        duration:  v.durationRaw || fmtSec(v.durationInSec),
        thumbnail: v.thumbnails?.sort((a,b)=>b.width-a.width)[0]?.url
                   || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
      }));
      return res.json({ items });
    }
  } catch (_) {}

  // 2) yt-dlp search
  try {
    const raw = await ytdlp([
      `ytsearch20:${q}`, '--dump-json', '--flat-playlist',
      '--no-playlist', '--quiet',
    ]);
    const items = raw.split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean)
      .map(v => ({
        id:        v.id,
        title:     v.title || 'Sem título',
        channel:   v.uploader || v.channel || 'Desconhecido',
        duration:  fmtSec(v.duration),
        thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
      }));
    return res.json({ items });
  } catch (err2) {
    console.error('[SEARCH ERROR]', err2.message);
  }

  // 3) youtube-search-api (último fallback)
  try {
    const { GetListByKeyword } = await import('youtube-search-api');
    const r = await GetListByKeyword(q, false, 20, [{ type: 'video' }]);
    const items = (r.items || []).filter(i=>i.type==='video'&&i.id).slice(0,20).map(i=>({
      id: i.id, title: i.title,
      channel: i.channelTitle||i.channel?.name||'Desconhecido',
      duration: i.length?.simpleText||'?:??',
      thumbnail: `https://i.ytimg.com/vi/${i.id}/hqdefault.jpg`,
    }));
    return res.json({ items });
  } catch (err3) {
    res.status(500).json({ error: 'Busca falhou', details: err3.message });
  }
});

// ──────────────────────────────────────────────────────────────
// STREAM — yt-dlp com retry em múltiplos clientes YouTube
// tv_embedded → ios → android → mweb (bypassa bot detection)
// ──────────────────────────────────────────────────────────────

// Prepara arquivo de cookies (se env var estiver configurada)
let COOKIES_FILE = null;
const { writeFileSync } = require('fs');
if (process.env.YOUTUBE_COOKIES) {
  COOKIES_FILE = path.join(os.tmpdir(), 'yt-cookies.txt');
  try {
    // Suporta conteúdo direto ou base64
    const content = Buffer.from(process.env.YOUTUBE_COOKIES, 'base64').toString('utf8');
    writeFileSync(COOKIES_FILE, content.startsWith('# Netscape') ? content : process.env.YOUTUBE_COOKIES);
    console.log('🍪 Cookies do YouTube carregados');
  } catch {
    COOKIES_FILE = null;
  }
}

// Clientes YouTube para tentar em ordem (do mais provável ao fallback)
const YT_CLIENTS = ['tv_embedded', 'ios', 'android_embedded', 'mweb', 'web'];

function buildArgs(client) {
  return [
    '--no-playlist', '--quiet', '--no-warnings',
    '--extractor-args', `youtube:player_client=${client}`,
    ...(COOKIES_FILE ? ['--cookies', COOKIES_FILE] : []),
  ];
}

app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  console.log(`[STREAM] Iniciando: ${videoId}`);

  // Tenta cada cliente até conseguir uma URL válida
  let audioUrl = null;
  let usedClient = null;
  for (const client of YT_CLIENTS) {
    try {
      const url = await ytdlp([
        '-g', '-f', 'bestaudio[ext=m4a]/bestaudio/best',
        ...buildArgs(client),
        ytUrl,
      ]);
      if (url && url.startsWith('http')) {
        audioUrl = url;
        usedClient = client;
        break;
      }
    } catch (e) {
      console.log(`[STREAM] Cliente ${client} falhou: ${e.message.slice(0, 80)}`);
    }
  }

  if (audioUrl) {
    console.log(`[STREAM] ✅ URL via cliente "${usedClient}"`);
    try {
      const range   = req.headers.range;
      const headers = { 'User-Agent': 'Mozilla/5.0' };
      if (range) headers['Range'] = range;

      const upstream = await fetch(audioUrl, { headers, signal: AbortSignal.timeout(20000) });
      if (!upstream.ok && upstream.status !== 206) throw new Error(`HTTP ${upstream.status}`);

      const ct = upstream.headers.get('content-type') || 'audio/mp4';
      const cl = upstream.headers.get('content-length');
      const cr = upstream.headers.get('content-range');
      res.setHeader('Content-Type', ct);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-cache');
      if (cl) res.setHeader('Content-Length', cl);
      if (cr) res.setHeader('Content-Range', cr);
      res.status(upstream.status === 206 ? 206 : 200);

      const reader = upstream.body.getReader();
      const pump = async () => {
        try {
          const { done, value } = await reader.read();
          if (done || res.writableEnded) { res.end(); return; }
          res.write(value); pump();
        } catch (_) { res.end(); }
      };
      pump();
      req.on('close', () => reader.cancel().catch(() => {}));
      return;
    } catch (e) {
      console.error('[STREAM] Proxy falhou, tentando pipe:', e.message);
    }
  }

  // Último recurso: pipe direto do yt-dlp → cliente
  console.log('[STREAM] Tentando pipe direto...');
  const client = usedClient || 'tv_embedded';
  const proc = spawn(YTDLP, [
    '-o', '-', '-f', 'bestaudio[ext=m4a]/bestaudio/best',
    ...buildArgs(client), ytUrl,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  if (res.headersSent) { proc.kill(); return; }
  res.setHeader('Content-Type', 'audio/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-cache');
  res.status(200);
  proc.stdout.pipe(res);
  req.on('close', () => proc.kill());
  proc.on('error', () => { if (!res.writableEnded) res.end(); });
  proc.stderr.on('data', d => {
    const msg = d.toString();
    if (!msg.includes('WARNING')) console.error('[YT-DLP]', msg.slice(0, 120));
  });
});

// ──────────────────────────────────────────────────────────────
// CAST — Descoberta de dispositivos (mDNS + SSDP + Subnet scan)
// Mesmo protocolo que o celular usa!
// ──────────────────────────────────────────────────────────────

// Sessões AirPlay ativas
const activeSessions = new Map();

// Pega todas as IPs locais não-loopback
function getLocalIPs() {
  const result = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces() || {})) {
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal) result.push({ ip: a.address, name });
    }
  }
  return result;
}
function getSubnets() { return [...new Set(getLocalIPs().map(i => i.ip.split('.').slice(0,3).join('.')))]; }

// ── TCP probe ──
function tcpProbe(ip, port, timeout = 500) {
  return new Promise(resolve => {
    const s = new net.Socket();
    s.setTimeout(timeout);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error',   () => { s.destroy(); resolve(false); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.connect(port, ip);
  });
}

// ── HTTP probe — tenta ler descrição DLNA/Cast ──
async function httpProbe(ip, port) {
  const paths = ['/', '/description.xml', '/rootDesc.xml', '/DeviceDescription.xml', '/ssdp/device-desc.xml'];
  for (const p of paths) {
    try {
      const r    = await fetch(`http://${ip}:${port}${p}`, { signal: AbortSignal.timeout(1200) });
      const text = await r.text();
      const name  = (text.match(/<friendlyName>([^<]+)<\/friendlyName>/) || [])[1];
      const model = (text.match(/<modelName>([^<]+)<\/modelName>/)       || [])[1];
      const isMedia = /AVTransport|MediaRenderer|MediaServer|urn:dial|Chromecast/i.test(text);
      if (name || isMedia) {
        let type = 'dlna';
        if (/Chromecast|Google/i.test(name || model || ''))       type = 'chromecast';
        else if (/TV|Television|display|Samsung|LG|Sony|Philips|Hisense|TCL/i.test(name || model || '')) type = 'tv';
        return { ip, port, name: name || model || ip, type, location: `http://${ip}:${port}${p}` };
      }
    } catch {}
  }
  return null;
}

// ── Constrói pacote DNS (para mDNS) ──
function buildDNSQuery(names) {
  const questions = [];
  for (const name of names) {
    const parts = name.split('.');
    const labels = [];
    for (const part of parts) {
      if (!part) continue;
      const l = Buffer.from(part, 'ascii');
      labels.push(Buffer.from([l.length]), l);
    }
    labels.push(Buffer.from([0])); // null terminator
    questions.push(Buffer.concat([...labels, Buffer.from([0x00, 0x0C, 0x00, 0x01])])); // PTR, IN
  }
  const header = Buffer.from([
    0x00, 0x00,              // ID = 0 (mDNS)
    0x00, 0x00,              // Flags = standard query
    0x00, names.length,      // QDCOUNT
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // AN/NS/AR = 0
  ]);
  return Buffer.concat([header, ...questions]);
}

// ── mDNS scan — MESMO protocolo que o celular usa! ──
// Chromecast usa _googlecast._tcp.local via mDNS (porta 5353, multicast 224.0.0.251)
function mdnsScan(timeoutMs = 5000) {
  return new Promise(resolve => {
    const foundIPs = new Set();
    const sockets  = [];
    const localIPs = getLocalIPs().map(i => i.ip);

    const query = buildDNSQuery([
      '_googlecast._tcp.local',
      '_airplay._tcp.local',
      '_raop._tcp.local',
    ]);

    // Tenta em cada interface de rede (resolve problema do Windows)
    for (const localIP of localIPs) {
      for (const bindAddr of [localIP, '0.0.0.0']) {
        try {
          const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
          sockets.push(sock);
          sock.on('message', (_, rinfo) => {
            if (!rinfo.address.startsWith('224.') && !rinfo.address.startsWith('239.')) {
              foundIPs.add(rinfo.address);
            }
          });
          sock.on('error', () => {});
          sock.bind(5353, bindAddr === '0.0.0.0' ? undefined : bindAddr, () => {
            try { sock.addMembership('224.0.0.251', localIP); } catch {}
            try { sock.setMulticastTTL(255); } catch {}
            try { sock.setMulticastInterface(localIP); } catch {}
            try { sock.send(query, 5353, '224.0.0.251'); } catch {}
          });
        } catch {}
      }
    }

    setTimeout(async () => {
      for (const s of sockets) { try { s.close(); } catch {} }
      // Probe cada IP que respondeu no mDNS
      const devices = [];
      await Promise.all([...foundIPs].map(async ip => {
        const info = await httpProbe(ip, 8008)
                  || await httpProbe(ip, 8009)
                  || await httpProbe(ip, 8200);
        devices.push(info || { ip, name: `Chromecast (${ip})`, type: 'chromecast', location: null, port: 8009 });
      }));
      resolve(devices);
    }, timeoutMs);
  });
}

// ── SSDP scan corrigido — bind em cada interface ──
function ssdpScan(timeoutMs = 5000) {
  return new Promise(resolve => {
    const found   = new Map();
    const sockets = [];
    const searches = [
      'urn:schemas-upnp-org:device:MediaRenderer:1',
      'urn:dial-multiscreen-org:service:dial:1',
      'upnp:rootdevice',
      'ssdp:all',
    ];
    const msg = (st) => Buffer.from(
      'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\n' +
      `ST: ${st}\r\n\r\n`
    );

    const localIPs = getLocalIPs().map(i => i.ip);
    if (!localIPs.length) localIPs.push('0.0.0.0');

    for (const localIP of localIPs) {
      try {
        const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        sockets.push(sock);
        sock.on('message', (buf, rinfo) => {
          if (found.has(rinfo.address)) return;
          const text = buf.toString();
          const loc  = (text.match(/LOCATION:\s*([^\r\n]+)/i) || [])[1]?.trim();
          const srv  = (text.match(/SERVER:\s*([^\r\n]+)/i)   || [])[1]?.trim();
          const st   = (text.match(/ST:\s*([^\r\n]+)/i)       || [])[1]?.trim();
          let type = 'dlna';
          if (/dial|Google|Chromecast/i.test((st||'') + (srv||''))) type = 'chromecast';
          else if (/Renderer/i.test(st||'')) type = 'tv';
          found.set(rinfo.address, { ip: rinfo.address, name: srv?.split('/')[0]?.trim() || rinfo.address, type, location: loc });
        });
        sock.on('error', () => {});
        sock.bind(0, localIP, () => {
          try { sock.setMulticastInterface(localIP); } catch {}
          try { sock.setMulticastTTL(4); } catch {}
          for (const st of searches) {
            try { sock.send(msg(st), 1900, '239.255.255.250'); } catch {}
          }
        });
      } catch {}
    }

    setTimeout(() => {
      for (const s of sockets) { try { s.close(); } catch {} }
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

// ── Subnet TCP scan (fallback rápido) ──
async function subnetScan(subnet) {
  const CAST_PORTS = [8009, 8008, 8200, 1400, 52235, 9000, 7000];
  const found = [];
  const BLOCK = 40;
  for (let start = 1; start <= 254; start += BLOCK) {
    const ips = [];
    for (let i = start; i < start + BLOCK && i <= 254; i++) ips.push(`${subnet}.${i}`);
    const hits = await Promise.all(
      ips.map(ip =>
        Promise.race(CAST_PORTS.map(port => tcpProbe(ip, port, 400).then(ok => ok ? { ip, port } : null)))
          .catch(() => null)
      )
    );
    for (const hit of hits.filter(Boolean)) {
      if (!found.find(d => d.ip === hit.ip)) {
        const info = await httpProbe(hit.ip, hit.port);
        found.push(info || {
          ip: hit.ip, port: hit.port,
          name: hit.ip,
          type: (hit.port === 8009 || hit.port === 8008) ? 'chromecast' : 'tv',
          location: null,
        });
      }
    }
  }
  return found;
}

// ── Endpoint principal ──
app.get('/api/cast/devices', async (req, res) => {
  const combined = new Map();
  const subnets  = getSubnets();

  // mDNS + SSDP + subnet em paralelo
  const [mdnsDevices, ssdpDevices, ...subnetResults] = await Promise.all([
    mdnsScan(5000),
    ssdpScan(5000),
    ...subnets.map(s => subnetScan(s)),
  ]);
  const all = [...mdnsDevices, ...ssdpDevices, ...subnetResults.flat()];
  for (const d of all) {
    const ex = combined.get(d.ip);
    if (!ex || (d.name !== d.ip && ex.name === ex.ip)) combined.set(d.ip, d);
  }

  // Enriquecer nomes via XML
  await Promise.all([...combined.values()].map(async d => {
    if (!d.location || d.name !== d.ip) return;
    try {
      const xml  = await fetch(d.location, { signal: AbortSignal.timeout(1500) }).then(r => r.text());
      const name = (xml.match(/<friendlyName>([^<]+)<\/friendlyName>/) || [])[1];
      if (name) d.name = name;
    } catch {}
  }));

  res.json({ devices: [...combined.values()], localIPs: getLocalIPs().map(i => i.ip) });
});

// ── Probe IP manual ──
app.get('/api/cast/probe', async (req, res) => {
  const ip = req.query.ip?.trim();
  if (!ip) return res.status(400).json({ error: 'ip required' });
  const PORTS = [8009, 8008, 8200, 1400, 52235, 49152, 9000, 7000, 2869, 80];
  const opens = (await Promise.all(PORTS.map(p => tcpProbe(ip, p, 1200).then(ok => ok ? p : null)))).filter(Boolean);
  if (!opens.length) return res.json({ found: false });
  const info = await httpProbe(ip, opens[0]);
  res.json({ found: true, device: info || { ip, port: opens[0], name: ip, type: 'dlna', location: null } });
});

// ── Fix automático do Firewall do Windows ──
app.post('/api/cast/fix-firewall', (req, res) => {
  if (process.platform !== 'win32') return res.json({ ok: true, msg: 'Não é Windows, não precisa.' });
  // Executa cada regra separadamente via cmd /c
  const cmds = [
    `netsh advfirewall firewall delete rule name="SpotAgrios-SSDP-IN"`,
    `netsh advfirewall firewall delete rule name="SpotAgrios-mDNS-IN"`,
    `netsh advfirewall firewall add rule name="SpotAgrios-SSDP-IN" protocol=UDP dir=in localport=1900 action=allow`,
    `netsh advfirewall firewall add rule name="SpotAgrios-mDNS-IN" protocol=UDP dir=in localport=5353 action=allow`,
    `netsh advfirewall firewall add rule name="SpotAgrios-SSDP-OUT" protocol=UDP dir=out localport=1900 action=allow`,
    `netsh advfirewall firewall add rule name="SpotAgrios-mDNS-OUT" protocol=UDP dir=out localport=5353 action=allow`,
  ];
  let pending = cmds.length;
  let failed  = false;
  for (const cmd of cmds) {
    exec(`cmd /c ${cmd}`, err => {
      if (err && !cmd.includes('delete')) failed = true;
      if (--pending === 0) {
        if (failed) {
          console.error('[FIREWALL] Falhou — execute como Administrador');
          res.json({ ok: false, msg: 'Execute o servidor como Administrador para configurar o Firewall.' });
        } else {
          console.log('✅ Regras de Firewall adicionadas (SSDP + mDNS)');
          res.json({ ok: true, msg: 'Firewall configurado!' });
        }
      }
    });
  }
});

// ──────────────────────────────────────────────────────────────
// CAST — Envio real de áudio para TV via DLNA/UPnP AVTransport
// ──────────────────────────────────────────────────────────────

// Constrói envelope SOAP
function buildSOAP(action, params) {
  const body = Object.entries(params)
    .map(([k, v]) => `<${k}>${v}</${k}>`)
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      ${body}
    </u:${action}>
  </s:Body>
</s:Envelope>`;
}

// Metadata DIDL-Lite para o AVTransport (descreve o recurso de áudio)
function buildDIDL(title, url, mime = 'audio/mpeg') {
  const safe = title.replace(/[<>&"']/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;' }[c]));
  return `&lt;DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"&gt;&lt;item id="0" parentID="-1" restricted="1"&gt;&lt;dc:title&gt;${safe}&lt;/dc:title&gt;&lt;upnp:class&gt;object.item.audioItem.musicTrack&lt;/upnp:class&gt;&lt;res protocolInfo="http-get:*:${mime}:*"&gt;${url}&lt;/res&gt;&lt;/item&gt;&lt;/DIDL-Lite&gt;`;
}

// Envia comando SOAP para o dispositivo DLNA
async function soapCmd(controlUrl, action, params, timeout = 5000) {
  const body = buildSOAP(action, params);
  const r = await fetch(controlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPAction': `"urn:schemas-upnp-org:service:AVTransport:1#${action}"`,
    },
    body,
    signal: AbortSignal.timeout(timeout),
  });
  return r;
}

// Resolve a URL de controle AVTransport do dispositivo DLNA
async function getControlURL(device) {
  const locs = [];
  if (device.location) locs.push(device.location);
  const { ip, port = 8200 } = device;
  locs.push(
    `http://${ip}:${port}/description.xml`,
    `http://${ip}:${port}/rootDesc.xml`,
    `http://${ip}:${port}/DeviceDescription.xml`,
    `http://${ip}:${port}/ssdp/device-desc.xml`,
    `http://${ip}:${port}/`,
    `http://${ip}:49152/description.xml`,
    `http://${ip}:52235/description.xml`,
  );

  for (const loc of locs) {
    try {
      const r = await fetch(loc, { signal: AbortSignal.timeout(3000) });
      const xml = await r.text();
      const match = xml.match(/<serviceType>[^<]*AVTransport[^<]*<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>/i);
      if (match) {
        const base = new URL(loc).origin;
        const path = match[1].trim();
        return path.startsWith('http') ? path : `${base}${path}`;
      }
    } catch {}
  }
  return null;
}

// POST /api/cast/play — envia música para a TV
app.post('/api/cast/play', async (req, res) => {
  const { device, videoId, title } = req.body || {};
  if (!device || !videoId) return res.status(400).json({ ok: false, error: 'device e videoId obrigatórios' });

  const serverIP = getLocalIPs()[0]?.ip || 'localhost';
  const streamUrl = `http://${serverIP}:${PORT}/api/stream/${videoId}`;
  console.log(`[CAST] Enviando para ${device.ip} → ${streamUrl}`);

  try {
    const controlUrl = await getControlURL(device);
    if (!controlUrl) {
      return res.json({ ok: false, error: `Dispositivo ${device.ip} não respondeu com AVTransport DLNA. Verifique se DLNA está ativado na TV.` });
    }
    console.log(`[CAST] Control URL: ${controlUrl}`);

    await soapCmd(controlUrl, 'SetAVTransportURI', {
      InstanceID: 0,
      CurrentURI: streamUrl,
      CurrentURIMetaData: buildDIDL(title || 'Spot Ágrios', streamUrl),
    });

    await soapCmd(controlUrl, 'Play', {
      InstanceID: 0,
      Speed: 1,
    });

    console.log(`[CAST] ✅ Transmitindo "${title}" para ${device.name}`);
    res.json({ ok: true, streamUrl, controlUrl });

  } catch (e) {
    console.error('[CAST ERROR]', e.message);
    res.json({ ok: false, error: e.message });
  }
});

// POST /api/cast/stop — para a reprodução na TV
app.post('/api/cast/stop', async (req, res) => {
  const { device, sessionKey } = req.body || {};

  // Para sessão AirPlay se ativa
  const key = sessionKey || device?.ip;
  if (key && activeSessions.has(key)) {
    const sess = activeSessions.get(key);
    try { await sess.stop(); } catch {}
    activeSessions.delete(key);
    console.log(`[AIRPLAY] Sessão encerrada: ${key}`);
  }

  // Para DLNA se tiver control URL
  if (device) {
    try {
      const controlUrl = await getControlURL(device);
      if (controlUrl) await soapCmd(controlUrl, 'Stop', { InstanceID: 0 });
    } catch {}
  }
  res.json({ ok: true });
});

// ──────────────────────────────────────────────────────────────
// CAST — AirPlay (RAOP) — mesmo protocolo do iPhone/Spotify
// ──────────────────────────────────────────────────────────────
app.post('/api/cast/airplay', async (req, res) => {
  const { device, videoId, title } = req.body || {};
  if (!device || !videoId) return res.status(400).json({ ok: false, error: 'device e videoId obrigatórios' });

  // Para sessão anterior no mesmo dispositivo
  const key = device.ip;
  if (activeSessions.has(key)) {
    try { await activeSessions.get(key).stop(); } catch {}
    activeSessions.delete(key);
  }

  // Porta AirPlay (padrão 5000 ou a detectada no mDNS)
  const airplayPort = device.airplayPort || device.port || 5000;

  console.log(`[AIRPLAY] Iniciando → ${device.ip}:${airplayPort} — "${title}"`);

  try {
    const session = await streamToAirPlay({
      ytdlpPath: YTDLP,
      host: device.ip,
      port: airplayPort,
      videoId,
    });

    activeSessions.set(key, session);
    console.log(`[AIRPLAY] ✅ Transmitindo "${title}" para ${device.name}`);
    res.json({ ok: true, protocol: 'airplay', device: device.name });

  } catch (e) {
    console.error('[AIRPLAY ERROR]', e.message);
    res.json({ ok: false, error: e.message });
  }
});

// ──────────────────────────────────────────────────────────────
// CAST — Proxy XML descrição DLNA
// ──────────────────────────────────────────────────────────────
app.get('/api/cast/dlna-desc', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const r   = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const xml = await r.text();
    const match = xml.match(/<serviceType>[^<]*AVTransport[^<]*<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>/i);
    res.json({ controlUrl: match?.[1] || null, xml });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ──────────────────────────────────────────────────────────────
// SPA
// ──────────────────────────────────────────────────────────────
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`🎵 Spot Ágrios → http://localhost:${PORT}`);
  console.log(`📦 yt-dlp: ${YTDLP}`);
});

function fmtSec(s) {
  if (!s) return '?:??';
  return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
}
