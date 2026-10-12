#!/usr/bin/env node
/**
 * MoneyMart — local TLS certificate generator.
 *
 * Creates a private CA and a `localhost` server certificate in .certs/ so the
 * unified gateway can serve HTTPS locally. TLS is not optional for a real
 * deployment: browsers will not grant camera access (listing photos, KYC) and
 * will refuse secure deep links on an insecure origin.
 *
 * Usage:
 *   node scripts/make-cert.mjs            # create if missing
 *   node scripts/make-cert.mjs --force    # regenerate
 *   node scripts/make-cert.mjs --trust    # also install the CA in the keychain
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const certDir = path.join(root, '.certs');
const force = process.argv.includes('--force');
const trust = process.argv.includes('--trust');

const CONFIG = `[req]
default_bits       = 2048
prompt             = no
default_md         = sha256
distinguished_name = dn
x509_extensions    = v3_ca

[dn]
C  = GB
O  = MoneyMart Local Development
CN = MoneyMart Local CA

[v3_ca]
basicConstraints = critical, CA:TRUE
keyUsage         = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash

[server_req]
default_bits       = 2048
prompt             = no
default_md         = sha256
distinguished_name = server_dn
req_extensions     = server_ext

[server_dn]
C  = GB
O  = MoneyMart Local Development
CN = localhost

[server_ext]
basicConstraints = critical, CA:FALSE
keyUsage         = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName   = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = *.localhost
IP.1  = 127.0.0.1
IP.2  = ::1
`;

function openssl(args) {
  return execFileSync('openssl', args, { cwd: certDir, stdio: ['ignore', 'pipe', 'pipe'] });
}

mkdirSync(certDir, { recursive: true });
writeFileSync(path.join(certDir, 'openssl.cnf'), CONFIG);

const caCert = path.join(certDir, 'ca.crt');
const caKey = path.join(certDir, 'ca.key');
const serverCert = path.join(certDir, 'server.crt');
const serverKey = path.join(certDir, 'server.key');

if (force) {
  [caCert, caKey, serverCert, serverKey].forEach((file) => existsSync(file) && rmSync(file));
}

if (existsSync(caCert) && existsSync(serverCert)) {
  console.log('  Certificate already present in .certs/ (use --force to regenerate)');
} else {
  console.log('  Generating a local CA and server certificate…');
  openssl(['genrsa', '-out', 'ca.key', '2048']);
  openssl(['req', '-x509', '-new', '-nodes', '-key', 'ca.key', '-sha256', '-days', '825', '-out', 'ca.crt', '-config', 'openssl.cnf']);
  openssl(['genrsa', '-out', 'server.key', '2048']);
  openssl(['req', '-new', '-key', 'server.key', '-out', 'server.csr', '-config', 'openssl.cnf', '-section', 'server_req']);
  openssl([
    'x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key',
    '-CAcreateserial', '-out', 'server.crt', '-days', '825', '-sha256',
    '-extfile', 'openssl.cnf', '-extensions', 'server_ext',
  ]);
  ['server.csr', 'ca.srl'].forEach((file) => {
    const target = path.join(certDir, file);
    if (existsSync(target)) rmSync(target);
  });
  console.log('  Created .certs/ca.crt and .certs/server.crt');
}

// Report the SAN so it is obvious what the certificate actually covers.
try {
  const text = execFileSync('openssl', ['x509', '-in', serverCert, '-noout', '-text'], { encoding: 'utf8' });
  const san = text.match(/Subject Alternative Name:\s*\n\s*(.+)/)?.[1]?.trim();
  console.log(`  SAN: ${san ?? 'unknown'}`);
} catch {
  console.log('  (could not read the certificate SAN)');
}

if (trust) {
  console.log('\n  Installing the CA into the login keychain (requires your password)…');
  try {
    execFileSync('security', ['add-trusted-cert', '-d', '-r', 'trustRoot', '-k', `${process.env.HOME}/Library/Keychains/login.keychain-db`, caCert], {
      stdio: 'inherit',
    });
    console.log('  CA trusted. Your browser will now accept https://localhost:3443 without a warning.');
  } catch (error) {
    console.log(`  Could not install automatically: ${error.message}`);
    console.log('  Trust it manually: Keychain Access → System → drag in .certs/ca.crt → Always Trust.');
  }
} else {
  console.log('\n  To run the unified deployment:  pnpm deploy:local');
  console.log('  A browser will warn until the CA is trusted. Either:');
  console.log('    • run: node scripts/make-cert.mjs --trust     (installs into the keychain)');
  console.log('    • or click through the warning once for localhost');
}
