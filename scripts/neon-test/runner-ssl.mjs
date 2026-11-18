// Correctif ciblé du garde d'URL du runner épinglé (#370 @4a18b74, scripts/db-migrate-lib.mjs) pour l'assemblage Neon Test.
//
// Problème : native-tls.mjs transmet au préflight, au runner et à Prisma la même URL `sslmode=require&sslaccept=strict`, mais
// parseTarget() du runner épinglé refuse tout paramètre hors liste blanche (« Paramètre d'URL non autorisé : sslaccept »).
// Correction : n'autoriser que la forme EXACTE `sslaccept=strict`, UNE seule fois, clé en minuscules. Toute autre variante reste
// refusée (accept_invalid_certs, valeur vide ou autre casse, doublon, clé en majuscules, autres paramètres de redirection).
//
// Le runner de #370 n'est pas modifié : le workflow applique ce correctif à la COPIE assemblée, après avoir vérifié l'empreinte du
// fichier source épinglé et celle du résultat. Usage : node scripts/neon-test/runner-ssl.mjs <chemin du db-migrate-lib.mjs copié>
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PINNED_RUNNER_LIB_SHA256 = 'b97287986136fd996f63be085a929da3403fc97001fc79cb1b58338e7384feea';
export const PATCHED_RUNNER_LIB_SHA256 = 'f0000ab8e443f022acc1f91a1f538450f6a2361cd79039c0b0d526f96d4682d2';

const sha = text => createHash('sha256').update(text).digest('hex');

const ORIGINAL_GUARD = `  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_QUERY.has(key.toLowerCase())) throw new RefusalError(\`Paramètre d'URL non autorisé : \${key}\`);
  }
`;

const PATCHED_GUARD = `  // Neon Test (#419) : sslaccept n'est admis que sous la forme exacte « sslaccept=strict », une seule fois, clé en minuscules.
  const sslAcceptKeys = [...url.searchParams.keys()].filter((key) => key.toLowerCase() === "sslaccept");
  if (sslAcceptKeys.length > 1 || (sslAcceptKeys.length === 1 && (sslAcceptKeys[0] !== "sslaccept" || url.searchParams.get("sslaccept") !== "strict"))) {
    throw new RefusalError("Paramètre d'URL non autorisé : sslaccept (seule la forme exacte sslaccept=strict est admise, une seule fois)");
  }
  for (const key of url.searchParams.keys()) {
    if (key === "sslaccept") continue; // validé ci-dessus
    if (!ALLOWED_QUERY.has(key.toLowerCase())) throw new RefusalError(\`Paramètre d'URL non autorisé : \${key}\`);
  }
`;

/** Pure : source épinglée -> source corrigée. Refuse toute source dont l'empreinte diffère, ou un résultat inattendu. */
export function patchRunnerLib(source) {
  if (sha(source) !== PINNED_RUNNER_LIB_SHA256) throw new Error('NEON_TEST_RUNNER_LIB_NOT_PINNED');
  if (source.split(ORIGINAL_GUARD).length !== 2) throw new Error('NEON_TEST_RUNNER_GUARD_NOT_FOUND');
  const patched = source.replace(ORIGINAL_GUARD, () => PATCHED_GUARD);
  if (sha(patched) !== PATCHED_RUNNER_LIB_SHA256) throw new Error('NEON_TEST_RUNNER_PATCH_RESULT');
  return patched;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const path = process.argv[2];
    if (!path || process.argv.length !== 3) throw new Error('NEON_TEST_RUNNER_PATCH_USAGE');
    writeFileSync(path, patchRunnerLib(readFileSync(path, 'utf8')));
    console.log('Garde d\'URL du runner corrigé : sslaccept=strict (forme exacte) admis, empreinte vérifiée avant et après.');
  } catch (error) {
    console.error(/^NEON_TEST_[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'NEON_TEST_RUNNER_PATCH_REFUSED');
    process.exitCode = 2;
  }
}
