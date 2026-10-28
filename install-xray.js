// Download and extract the xray-core binary for linux-64.
// Runs at build time (postinstall) so the binary is baked into the image.
// Pure-Node ZIP+deflate extraction: the velixir build image has neither
// `unzip` nor `python3`, so no system tool is used at all.
// If the binary is already present, this is a no-op.
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const BIN = path.join(__dirname, 'xray');
const ZIP = path.join(__dirname, 'xray.zip');
const URL = 'https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip';

function download(url, dest, redirectsLeft) {
  const left = redirectsLeft == null ? 5 : redirectsLeft;
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          timeout: 120000,
          headers: { 'User-Agent': 'velixir-xray/1.0' },
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            if (left <= 0) return reject(new Error('too many redirects'));
            return download(res.headers.location, dest, left - 1).then(resolve, reject);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error('download failed: HTTP ' + res.statusCode));
          }
          const out = fs.createWriteStream(dest);
          res.pipe(out);
          out.on('finish', () => out.close(resolve));
          out.on('error', reject);
        }
      )
      .on('error', reject)
      .on('timeout', function () {
        this.destroy(new Error('download timeout'));
      });
  });
}

/** Minimal ZIP reader: find the local-file entry named `xray` and inflate it. */
function extractXrayFromZip(zipBuf, destPath) {
  const sig = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
  let offset = 0;
  while (offset + 30 <= zipBuf.length) {
    const i = zipBuf.indexOf(sig, offset);
    if (i < 0) break;
    const compression = zipBuf.readUInt16LE(i + 8);
    const compSize = zipBuf.readUInt32LE(i + 18);
    const nameLen = zipBuf.readUInt16LE(i + 26);
    const extraLen = zipBuf.readUInt16LE(i + 28);
    const nameStart = i + 30;
    const nameEnd = nameStart + nameLen;
    if (nameEnd + extraLen + compSize > zipBuf.length) {
      offset = i + 4;
      continue;
    }
    const name = zipBuf.slice(nameStart, nameEnd).toString('utf8');
    const dataStart = nameEnd + extraLen;
    const dataEnd = dataStart + compSize;
    const base = name.split('/').pop();
    if (base === 'xray') {
      const compressed = zipBuf.slice(dataStart, dataEnd);
      let raw;
      if (compression === 0) {
        raw = compressed;
      } else if (compression === 8) {
        raw = zlib.inflateRawSync(compressed);
      } else {
        throw new Error('unsupported ZIP compression ' + compression + ' for ' + name);
      }
      fs.writeFileSync(destPath, raw);
      fs.chmodSync(destPath, 0o755);
      return raw.length;
    }
    offset = dataEnd;
  }
  throw new Error('xray entry not found in zip');
}

async function main() {
  if (fs.existsSync(BIN)) {
    try {
      fs.chmodSync(BIN, 0o755);
    } catch (e) {}
    console.log('xray binary already present, skipping download.');
    return;
  }
  console.log('downloading xray-core...');
  await download(URL, ZIP);
  const zipBuf = fs.readFileSync(ZIP);
  const bytes = extractXrayFromZip(zipBuf, BIN);
  console.log('xray extracted, bytes: ' + bytes);
  fs.unlinkSync(ZIP);
  console.log('xray binary ready.');
}

main().catch((err) => {
  console.error('install-xray failed:', err.message);
  process.exit(1);
});
