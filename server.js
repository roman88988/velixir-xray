// Node.js app that runs xray (VLESS + WebSocket) behind the velixir edge.
// The edge terminates TLS on the app's velixir.run domain; xray itself serves
// plain WebSocket on localhost. This process also serves:
//   GET /health  -> 200 ok (for the platform health probe)
//   GET /       -> simple status page (no secrets)
//   GET /sub    -> Shadowrocket subscription (base64 of the vless link)
//   GET /clash  -> Clash subscription YAML
// Secrets (UUID, WS_PATH) come from environment variables only, never from
// the repo. The node domain is derived from the request Host header, so no
// hardcoded domain is needed.
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const PORT = parseInt(process.env.PORT || '3000', 10);
const XRAY_PORT = parseInt(process.env.XRAY_PORT || '10000', 10);
const UUID = process.env.UUID || '';
const WS_PATH = process.env.WS_PATH || '/xray-ws';
const NODE_NAME = process.env.NODE_NAME || 'velixir-xray';

function writeXrayConfig() {
  const config = {
    log: { loglevel: 'warning' },
    inbounds: [
      {
        port: XRAY_PORT,
        listen: '127.0.0.1',
        protocol: 'vless',
        settings: {
          clients: [{ id: UUID }],
          decryption: 'none',
        },
        streamSettings: {
          network: 'ws',
          wsSettings: { path: WS_PATH },
        },
      },
    ],
    outbounds: [{ protocol: 'freedom' }],
  };
  fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config));
}

function ensureXrayBinary() {
  const bin = path.join(__dirname, 'xray');
  if (!fs.existsSync(bin)) {
    console.log('xray binary missing, running install-xray.js...');
    execSync('node ' + JSON.stringify(path.join(__dirname, 'install-xray.js')), { stdio: 'inherit' });
  }
  fs.chmodSync(bin, 0o755);
}

function startXray() {
  writeXrayConfig();
  const xray = spawn(path.join(__dirname, 'xray'), ['-c', path.join(__dirname, 'config.json')], {
    stdio: 'inherit',
  });
  xray.on('exit', (code) => {
    console.error('xray exited with code ' + code + ', restarting in 3s...');
    setTimeout(startXray, 3000);
  });
  return xray;
}

function hostOf(req) {
  return (req.headers.host || '').split(':')[0];
}

function vlessLink(host) {
  const p = encodeURIComponent(WS_PATH);
  return (
    'vless://' + UUID + '@' + host + ':443' +
    '?encryption=none&security=tls&sni=' + host +
    '&type=ws&host=' + host + '&path=' + p + '#' + encodeURIComponent(NODE_NAME)
  );
}

function clashYaml(host) {
  return [
    'proxies:',
    '  - name: ' + NODE_NAME,
    '    type: vless',
    '    server: ' + host,
    '    port: 443',
    '    uuid: ' + UUID,
    '    tls: true',
    '    servername: ' + host,
    '    network: ws',
    '    ws-opts:',
    '      path: ' + WS_PATH,
    '      headers:',
    '        Host: ' + host,
    'proxy-groups:',
    '  - name: PROXY',
    '    type: select',
    '    proxies:',
    '      - ' + NODE_NAME,
    'rules:',
    '  - MATCH,PROXY',
    '',
  ].join('\n');
}

function main() {
  if (!UUID) {
    console.error('UUID env var is required.');
    process.exit(1);
  }
  ensureXrayBinary();
  startXray();

  const server = http.createServer((req, res) => {
    const host = hostOf(req);
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    } else if (req.url === '/sub') {
      const body = Buffer.from(vlessLink(host) + '\n').toString('base64');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(body);
    } else if (req.url === '/clash') {
      res.writeHead(200, { 'Content-Type': 'text/yaml; charset=utf-8' });
      res.end(clashYaml(host));
    } else if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>' + NODE_NAME + '</h1><p>running</p>');
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    }
  });

  // Proxy WebSocket upgrades on WS_PATH through to xray's local WS inbound.
  server.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch (e) {
      pathname = req.url;
    }
    if (pathname !== WS_PATH) {
      socket.destroy();
      return;
    }
    const target = net.connect(XRAY_PORT, '127.0.0.1', () => {
      const headers = Object.entries(req.headers)
        .map(([k, v]) => k + ': ' + v)
        .join('\r\n');
      target.write(req.method + ' ' + req.url + ' HTTP/' + req.httpVersion + '\r\n' + headers + '\r\n\r\n');
      if (head && head.length) target.write(head);
      socket.pipe(target);
      target.pipe(socket);
    });
    target.on('error', () => socket.destroy());
    socket.on('error', () => target.destroy());
  });

  server.listen(PORT, () => {
    console.log('listening on port ' + PORT + ', WS path ' + WS_PATH);
  });
}

main();
