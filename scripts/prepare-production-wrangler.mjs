import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const templatePath = resolve(root, 'wrangler.production.jsonc');
const outputPath = resolve(root, 'wrangler.production.local.jsonc');
const stagingRef = 'admyuepbbtstayaydjmo';

export function makeProductionWranglerConfig(projectRef) {
  if (!/^[a-z0-9]{20}$/.test(projectRef) || projectRef === stagingRef) {
    throw new Error('Provide the verified 20-character production project reference; staging is rejected.');
  }
  const config = JSON.parse(readFileSync(templatePath, 'utf8'));
  config.vars.SUPABASE_PROJECT_ORIGIN = `https://${projectRef}.supabase.co`;
  return `${JSON.stringify(config, null, 2)}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projectRef = process.argv[2];
  if (!projectRef || process.argv.length !== 3) {
    console.error('Usage: node scripts/prepare-production-wrangler.mjs <verified-production-project-ref>');
    process.exitCode = 2;
  } else {
    try {
      writeFileSync(outputPath, makeProductionWranglerConfig(projectRef), { flag: 'wx' });
      console.log('Created ignored wrangler.production.local.jsonc with the supplied Supabase origin. No cloud resource was changed.');
    } catch (error) {
      console.error(`Production config generation failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
