#!/usr/bin/env node
/**
 * setup.js — Baixa automaticamente o yt-dlp correto para o sistema operacional.
 * Roda no postinstall (npm install) e no start quando em produção.
 */
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const { execSync } = require('child_process');

const isWin  = process.platform === 'win32';
const isArm  = process.arch === 'arm64';
const isMac  = process.platform === 'darwin';

const BINARY = isWin ? 'yt-dlp.exe'
             : isMac ? 'yt-dlp_macos'
             : isArm ? 'yt-dlp_linux_aarch64'
             : 'yt-dlp_linux';

const URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${BINARY}`;
const DEST = path.join(__dirname, isWin ? 'yt-dlp.exe' : 'yt-dlp');

function download(url, dest, redirects = 0) {
  if (redirects > 5) { console.error('Too many redirects'); process.exit(1); }
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': 'SpotAgrios/1.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.destroy();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest, redirects + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  if (fs.existsSync(DEST)) {
    console.log(`✅ yt-dlp já existe: ${DEST}`);
    // Tenta atualizar se em produção
    if (process.env.NODE_ENV === 'production') {
      try { execSync(`${DEST} --update-to stable`, { stdio: 'ignore', timeout: 30000 }); } catch {}
    }
    return;
  }

  console.log(`📥 Baixando yt-dlp para ${process.platform} (${process.arch})...`);
  console.log(`   URL: ${URL}`);

  try {
    await download(URL, DEST);
    if (!isWin) {
      execSync(`chmod +x "${DEST}"`);
    }
    console.log(`✅ yt-dlp instalado em: ${DEST}`);
  } catch (e) {
    console.error('❌ Falha ao baixar yt-dlp:', e.message);
    console.error('   Instale manualmente: https://github.com/yt-dlp/yt-dlp/releases');
    process.exit(1);
  }
}

main();
