/**
 * Grant a user membership to a pharmacy.
 *
 * This is the "manual onboarding" tool — for now we use it instead of
 * a self-serve signup flow.
 *
 * Usage:
 *   npx tsx scripts/grant-membership.ts <email> <pharmacy-name> [role]
 *
 * Example:
 *   npx tsx scripts/grant-membership.ts jethrogoldsmith@gmail.com "Reckon Test Pharmacy"
 *   npx tsx scripts/grant-membership.ts stuart@burnspharmacy.co.uk "Burns Pharmacy Group" owner
 *
 * The user MUST have signed in at least once before this runs (so they have
 * an auth.users row). Otherwise this will fail with "user not found".
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Load .env.local manually (no dotenv dep)
const envPath = join(process.cwd(), '.env.local');
const envContent = readFileSync(envPath, 'utf-8');
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  const value = trimmed.slice(eq + 1).trim();
  if (!process.env[key]) process.env[key] = value;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const [, , email, pharmacyName, role = 'member'] = process.argv;
if (!email || !pharmacyName) {
  console.error('Usage: tsx scripts/grant-membership.ts <email> <pharmacy-name> [role]');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  // 1. Find the auth user by email
  console.log(`→ Looking up user ${email}...`);
  const { data: usersList, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) {
    console.error('Failed to list users:', listError.message);
    process.exit(1);
  }
  const user = usersList.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    console.error(`User ${email} not found in auth.users.`);
    console.error('Have they clicked a magic link at least once? Sign in first, then re-run this script.');
    process.exit(1);
  }
  console.log(`  found auth user id=${user.id}`);

  // 2. Find the pharmacy by name
  console.log(`→ Looking up pharmacy "${pharmacyName}"...`);
  const { data: pharmacies, error: pharmError } = await supabase
    .from('pharmacies')
    .select('id, name')
    .eq('name', pharmacyName)
    .limit(1);
  if (pharmError) {
    console.error('Failed to query pharmacies:', pharmError.message);
    process.exit(1);
  }
  if (!pharmacies || pharmacies.length === 0) {
    console.error(`No pharmacy named "${pharmacyName}" found. Available pharmacies:`);
    const { data: all } = await supabase.from('pharmacies').select('name');
    all?.forEach(p => console.error(`  - ${p.name}`));
    process.exit(1);
  }
  const pharmacy = pharmacies[0]!;
  console.log(`  found pharmacy id=${pharmacy.id}`);

  // 3. Insert (or update) the membership
  console.log(`→ Granting ${role} membership...`);
  const { error: insertError } = await supabase
    .from('pharmacy_memberships')
    .upsert(
      { pharmacy_id: pharmacy.id, user_id: user.id, role },
      { onConflict: 'pharmacy_id,user_id' }
    );
  if (insertError) {
    console.error('Failed to insert membership:', insertError.message);
    process.exit(1);
  }

  console.log(`✓ Done. ${email} is now a ${role} of "${pharmacy.name}".`);
  console.log(`  They can now sign in at http://localhost:3000`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
