// Download and extract the xray-core binary for linux-64.
// Runs at build time (postinstall) so the binary is baked into the image.
// If the binary is already present, this is a no-op.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const BIN = path.join(__dirname, 'xray');
const ZIP = path.join(__dirname, 'xray.zip');
const URL = 'https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip';

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error('download failed: HTTP ' + res.statusCode));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      try { fs.unlinkSync(dest); } catch (e) {}
      reject(err);
    });
  });
}

async function main() {
  if (fs.existsSync(BIN)) {
    try { fs.chmodSync(BIN, 0o755); } catch (e) {}
    console.log('xray binary already present, skipping download.');
    return;
  }
  console.log('downloading xray-core...');
  await download(URL, ZIP);
  try {
    execSync('unzip -o ' + JSON.stringify(ZIP) + ' xray -d ' + JSON.stringify(__dirname), { stdio: 'inherit' });
  } catch (e) {
    console.log('unzip failed, falling back to python3 zipfile...');
    execSync('python3 -m zipfile -e ' + JSON.stringify(ZIP) + ' ' + JSON.stringify(__dirname), { stdio: 'inherit' });
  }
  fs.chmodSync(BIN, 0o755);
  fs.unlinkSync(ZIP);
  console.log('xray binary ready.');
}

main().catch((err) => {
  console.error('install-xray failed:', err.message);
  process.exit(1);
});
