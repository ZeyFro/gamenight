// Prisma 6 natif : sslmode=require impose TLS ; sslaccept=strict impose la
// validation CA/certificat/hôte. verify-full n'est pas un mode du moteur 6.
// La même URL doit alimenter le client SQL, le préflight et le runner épinglé.
export function strictNativeConnection(connection) {
  const refuse = () => { throw new Error('NEON_TEST_NATIVE_TLS_CONFIGURATION'); };
  let url;
  try { url = new URL(connection); } catch { refuse(); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hash) refuse();
  const allowed = new Set(['sslmode', 'sslaccept', 'channel_binding', 'connect_timeout', 'pool_timeout', 'connection_limit']);
  for (const key of url.searchParams.keys()) if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) refuse();
  if (!['require', 'verify-full'].includes(url.searchParams.get('sslmode'))) refuse();
  if (url.searchParams.has('sslaccept') && url.searchParams.get('sslaccept') !== 'strict') refuse();
  url.searchParams.set('sslmode', 'require');
  url.searchParams.set('sslaccept', 'strict');
  return url.href;
}
