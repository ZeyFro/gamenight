// Exercice local facultatif : aucun secret distant, aucune migration ni écriture SQL.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import tls from 'node:tls';
import { strictNativeConnection } from './native-tls.mjs';

async function main() {
  const backend = new URL(process.env.TEST_DATABASE_URL ?? '');
  if (!['postgres:', 'postgresql:'].includes(backend.protocol) || backend.hostname !== '127.0.0.1' || backend.search || backend.hash || !/^gamenight_apply_rehearsal_[a-z0-9_]+$/.test(backend.pathname.slice(1))) throw Error('LOCAL_TLS_TARGET_REFUSED');
  const dir = mkdtempSync(join(tmpdir(), 'gamenight-native-tls-'));
  const servers = [];
  const sockets = new Set();
  const childEnv = { ...process.env };
  for (const key of ['MIGRATION_DATABASE_URL', 'TEST_DATABASE_URL', 'DATABASE_URL', 'SSL_CERT_FILE', 'SSL_CERT_DIR']) delete childEnv[key];
  const run = (args, env, input) => new Promise(resolve => {
    const process = spawn(globalThis.process.execPath, args, { env, stdio: ['pipe', 'pipe', 'ignore'], timeout: 20000 });
    let output = '';
    process.stdout.on('data', data => { output += data; });
    process.stdin.end(input);
    process.on('error', () => resolve({ code: -1, output: '' }));
    process.on('close', code => resolve({ code, output }));
  });
  try {
    for (const [name, san] of [['valid', 'IP:127.0.0.1'], ['wrong', 'DNS:wrong.example.test']]) {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1', '-subj', '/CN=GameNight test only', '-addext', `subjectAltName=${san}`, '-keyout', join(dir, name + '.key'), '-out', join(dir, name + '.crt')], { stdio: 'ignore' });
    }
    const open = async name => {
      const context = tls.createSecureContext({ key: readFileSync(join(dir, name + '.key')), cert: readFileSync(join(dir, name + '.crt')) });
      const server = net.createServer(socket => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.once('data', bytes => {
          if (bytes.length !== 8 || bytes.readInt32BE(0) !== 8 || bytes.readInt32BE(4) !== 80877103) { socket.destroy(); return; }
          socket.write('S');
          const secure = new tls.TLSSocket(socket, { isServer: true, secureContext: context });
          secure.on('error', () => socket.destroy());
          secure.once('secure', () => {
            const back = net.connect({ host: '127.0.0.1', port: Number(backend.port || 5432) }, () => { secure.pipe(back); back.pipe(secure); });
            back.on('error', () => secure.destroy());
            secure.on('close', () => back.destroy());
          });
        });
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      servers.push(server);
      return server.address().port;
    };
    const valid = await open('valid');
    const wrong = await open('wrong');
    const cases = [['valid', valid, 'valid', true], ['untrusted', valid, null, false], ['wrong-host', wrong, 'wrong', false], ['plaintext', Number(backend.port || 5432), null, false]];
    for (const [name, port, ca, expected] of cases) {
      const target = new URL(backend);
      target.port = String(port);
      target.searchParams.set('sslmode', 'require');
      const env = { ...childEnv, DATABASE_URL: strictNativeConnection(target.href), ...(ca ? { SSL_CERT_FILE: join(dir, ca + '.crt') } : {}) };
      const query = "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.$queryRawUnsafe('SELECT (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS backend_ssl').then(x=>console.log(JSON.stringify(x))).catch(()=>{process.exitCode=2}).finally(()=>p.$disconnect())";
      const client = await run(['-e', query], env);
      const cli = await run(['node_modules/prisma/build/index.js', 'db', 'execute', '--stdin', '--schema=prisma/schema.prisma'], env, 'BEGIN READ ONLY; SELECT 1; COMMIT;');
      if ((client.code === 0) !== expected || (cli.code === 0) !== expected) throw Error('LOCAL_TLS_EXPECTATION_FAILED');
      if (expected && JSON.parse(client.output)[0].backend_ssl !== false) throw Error('LOCAL_TLS_BACKEND_MUST_BE_PLAINTEXT');
      console.log(`TLS natif local ${name} : client et CLI ${expected ? 'acceptés, backend SSL false' : 'refusés'}.`);
    }
  } finally {
    for (const socket of sockets) socket.destroy();
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(() => { console.error('LOCAL_TLS_REHEARSAL_REFUSED_OR_FAILED'); process.exitCode = 2; });
