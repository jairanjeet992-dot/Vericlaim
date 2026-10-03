import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Parse .env.local manually so ts-node / node can load without extra dependencies
function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.substring(0, idx).trim();
        const val = trimmed.substring(idx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function seed() {
  console.log('====================================================');
  console.log('VERICLAIM SAAS: SEEDING INITIAL TENANT & USERS');
  console.log('====================================================');

  // 1. Verify schema tables exist
  const { error: checkErr } = await supabase.from('agencies').select('id').limit(1);
  if (checkErr) {
    console.error('\n❌ ERROR: Database tables do not exist yet in Supabase!');
    console.error('Reason:', checkErr.message);
    console.log('\n👉 HOW TO FIX:');
    console.log('1. Open your Supabase project: https://supabase.com/dashboard');
    console.log('2. Click on "SQL Editor" in the left menu.');
    console.log('3. Copy the entire contents of file: "supabase/complete_setup.sql"');
    console.log('4. Paste into the SQL Editor and click "Run".');
    console.log('5. Once done, run this command again: npm run seed\n');
    process.exit(1);
  }

  // 2. Ensure Free Plan exists
  let planId: string;
  const { data: existingPlan } = await supabase
    .from('plans')
    .select('id')
    .eq('name', 'Free')
    .maybeSingle();

  if (existingPlan) {
    planId = existingPlan.id;
  } else {
    const { data: newPlan, error: planErr } = await supabase
      .from('plans')
      .insert({
        name: 'Free',
        tier: 'free',
        max_users: 10,
        max_cases_per_month: 200,
        show_branding_footer: true,
      })
      .select('id')
      .single();

    if (planErr) throw planErr;
    planId = newPlan.id;
  }
  console.log('✓ Default plan verified:', planId);

  // 3. Create or get Agency: DNA
  let agencyId: string;
  const { data: existingAgency } = await supabase
    .from('agencies')
    .select('id')
    .eq('code', 'DNA')
    .maybeSingle();

  if (existingAgency) {
    agencyId = existingAgency.id;
    console.log('✓ Agency already exists (DNA):', agencyId);
  } else {
    const { data: newAgency, error: agErr } = await supabase
      .from('agencies')
      .insert({
        code: 'DNA',
        name: 'DNA Professional Investigation Agency',
        slug: 'dna-investigations',
        state_code: '23',
        gstin: '23AAACD1234A1Z5',
        address: 'Plot 42, MP Nagar Zone II, Bhopal, MP 462011',
        phone: '+91 98260 00000',
        email: 'contact@dna-investigations.in',
        is_active: true,
      })
      .select('id')
      .single();

    if (agErr) throw agErr;
    agencyId = newAgency.id;

    // Subscription
    await supabase.from('agency_subscriptions').insert({
      agency_id: agencyId,
      plan_id: planId,
      status: 'active',
    });

    console.log('✓ Provisioned new agency (DNA):', agencyId);
  }

  // 4. Seed Default Agency Roles via RPC
  try {
    await supabase.rpc('seed_agency_default_roles', { p_agency_id: agencyId });
  } catch (e) {
    // Ignore if already seeded
  }
  console.log('✓ Agency default roles seeded');

  // 5. Create Agency Owner / Admin User
  // Synthetic email: u_admin_dna@auth.vericlaim.in
  const adminEmail = `u_${agencyId.substring(0, 8)}_admin@auth.vericlaim.in`;
  const defaultPassword = 'Password@123';

  let adminAuthUserId: string;
  // Check if auth user exists
  const { data: userList } = await supabase.auth.admin.listUsers();
  const foundAuthUser = userList?.users?.find((u) => u.email === adminEmail);

  if (foundAuthUser) {
    adminAuthUserId = foundAuthUser.id;
    // Reset password to default
    await supabase.auth.admin.updateUserById(adminAuthUserId, { password: defaultPassword });
  } else {
    const { data: newAuth, error: authErr } = await supabase.auth.admin.createUser({
      email: adminEmail,
      password: defaultPassword,
      email_confirm: true,
      user_metadata: { agency_id: agencyId, username: 'admin', full_name: 'Rajesh Sharma' },
    });
    if (authErr) throw authErr;
    adminAuthUserId = newAuth.user.id;
  }

  // Upsert public.users row
  let adminUserId: string;
  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('agency_id', agencyId)
    .eq('username', 'admin')
    .maybeSingle();

  if (existingUser) {
    adminUserId = existingUser.id;
  } else {
    const { data: newUser, error: uErr } = await supabase
      .from('users')
      .insert({
        agency_id: agencyId,
        auth_user_id: adminAuthUserId,
        synthetic_auth_email: adminEmail,
        username: 'admin',
        full_name: 'Rajesh Sharma (Agency Admin)',
        phone: '+91 98260 11111',
        scope: 'ALL',
        is_active: true,
      })
      .select('id')
      .single();

    if (uErr) throw uErr;
    adminUserId = newUser.id;

    // Link role
    const { data: ownerRole } = await supabase
      .from('roles')
      .select('id')
      .eq('agency_id', agencyId)
      .eq('name', 'Agency Owner')
      .maybeSingle();

    if (ownerRole) {
      await supabase.from('user_roles').insert({ user_id: adminUserId, role_id: ownerRole.id });
    }
  }
  console.log('✓ Agency Admin user created: admin / Password@123');

  // 6. Seed Agency Masters (Case types, outcomes, SLA)
  try {
    await supabase.rpc('seed_agency_masters', {
      p_agency_id: agencyId,
    });
  } catch (e) {
    // Ignore if already seeded
  }
  console.log('✓ Case types, outcomes & SLA masters seeded');

  // 7. Create Field Investigator User
  const invEmail = `u_${agencyId.substring(0, 8)}_inv1@auth.vericlaim.in`;
  let invAuthUserId: string;
  const foundInv = userList?.users?.find((u) => u.email === invEmail);

  if (foundInv) {
    invAuthUserId = foundInv.id;
    await supabase.auth.admin.updateUserById(invAuthUserId, { password: defaultPassword });
  } else {
    const { data: newInvAuth, error: invAuthErr } = await supabase.auth.admin.createUser({
      email: invEmail,
      password: defaultPassword,
      email_confirm: true,
      user_metadata: { agency_id: agencyId, username: 'investigator1', full_name: 'Vikram Solanki' },
    });
    if (invAuthErr) throw invAuthErr;
    invAuthUserId = newInvAuth.user.id;
  }

  let invUserId: string;
  const { data: existingInvUser } = await supabase
    .from('users')
    .select('id')
    .eq('agency_id', agencyId)
    .eq('username', 'investigator1')
    .maybeSingle();

  if (existingInvUser) {
    invUserId = existingInvUser.id;
  } else {
    const { data: newInv, error: invErr } = await supabase
      .from('users')
      .insert({
        agency_id: agencyId,
        auth_user_id: invAuthUserId,
        synthetic_auth_email: invEmail,
        username: 'investigator1',
        full_name: 'Vikram Solanki (Field Investigator)',
        phone: '+91 98260 22222',
        scope: 'ASSIGNED',
        reports_to_id: adminUserId,
        is_active: true,
      })
      .select('id')
      .single();

    if (invErr) throw invErr;
    invUserId = newInv.id;

    // Link investigator role
    const { data: invRole } = await supabase
      .from('roles')
      .select('id')
      .eq('agency_id', agencyId)
      .eq('name', 'Field Investigator')
      .maybeSingle();

    if (invRole) {
      await supabase.from('user_roles').insert({ user_id: invUserId, role_id: invRole.id });
    }
  }

  // Create Investigator Profile
  let investigatorProfileId: string;
  const { data: existingProfile } = await supabase
    .from('investigators')
    .select('id')
    .eq('agency_id', agencyId)
    .eq('user_id', invUserId)
    .maybeSingle();

  if (existingProfile) {
    investigatorProfileId = existingProfile.id;
  } else {
    const { data: newProfile, error: profErr } = await supabase
      .from('investigators')
      .insert({
        agency_id: agencyId,
        user_id: invUserId,
        code: 'INV-01',
        full_name: 'Vikram Solanki',
        phone: '+91 98260 22222',
        email: 'vikram.solanki@dna-investigations.in',
        city: 'Bhopal',
        state: 'Madhya Pradesh',
        pincodes: ['462001', '462011', '462023'],
        radius_km: 40,
        max_active_cases: 8,
        is_available: true,
        is_active: true,
      })
      .select('id')
      .single();

    if (profErr) throw profErr;
    investigatorProfileId = newProfile.id;

    // Add per-case fee term
    await supabase.from('investigator_payment_terms').insert({
      agency_id: agencyId,
      investigator_id: investigatorProfileId,
      payment_type: 'PER_CASE',
      base_fee_or_salary: 1000.0,
      effective_from: '2026-01-01',
      created_by: adminUserId,
    });
  }
  console.log('✓ Field Investigator created: investigator1 / Password@123');

  // 8. Create Sample Clients
  let clientId: string;
  const { data: existingClient } = await supabase
    .from('clients')
    .select('id')
    .eq('agency_id', agencyId)
    .eq('code', 'ICICI-LOMBARD')
    .maybeSingle();

  if (existingClient) {
    clientId = existingClient.id;
  } else {
    const { data: newClient, error: clientErr } = await supabase
      .from('clients')
      .insert({
        agency_id: agencyId,
        name: 'ICICI Lombard General Insurance',
        code: 'ICICI-LOMBARD',
        is_active: true,
      })
      .select('id')
      .single();

    if (clientErr) throw clientErr;
    clientId = newClient.id;

    // Create Branch
    await supabase.from('client_branches').insert({
      agency_id: agencyId,
      client_id: clientId,
      branch_name: 'Bhopal Regional Hub',
      legal_name: 'ICICI Lombard General Insurance Co. Ltd.',
      gstin: '23AAACI1234A1Z9',
      state: 'Madhya Pradesh',
      state_code: '23',
      billing_address: 'Zone I, MP Nagar, Bhopal 462011',
      is_default: true,
    });
  }
  console.log('✓ Sample Client & Branch created (ICICI Lombard)');

  // 9. Fetch Case Type
  const { data: caseType } = await supabase
    .from('case_types')
    .select('id')
    .eq('agency_id', agencyId)
    .limit(1)
    .single();

  const caseTypeId = caseType?.id;

  // 10. Create Sample Case 1 (Assigned to investigator1)
  const { data: existingCase } = await supabase
    .from('cases')
    .select('id')
    .eq('agency_id', agencyId)
    .eq('claim_no', 'CLM-2026-0812')
    .maybeSingle();

  if (!existingCase && caseTypeId) {
    const { data: case1, error: c1Err } = await supabase
      .from('cases')
      .insert({
        agency_id: agencyId,
        doc_code: 'OCT26-0001',
        client_id: clientId,
        case_type: 'Cashless',
        case_type_id: caseTypeId,
        claim_no: 'CLM-2026-0812',
        normalized_claim_no: 'CLM-2026-0812',
        policy_no: 'POL-9923847',
        insured_name: 'Amitabh Saxena',
        hospital_name: 'City Care Hospital, Bhopal',
        hospital_city: 'Bhopal',
        hospital_state: 'Madhya Pradesh',
        hospital_pincode: '462011',
        claim_amount: 145000.0,
        risk_level: 'MEDIUM',
        status: 'FIELD_INVESTIGATION',
        owner_manager_id: adminUserId,
        data_entry_user_id: adminUserId,
        due_date: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
      })
      .select('id')
      .single();

    if (c1Err) throw c1Err;

    // Assign to investigator1
    await supabase.from('case_investigators').insert({
      agency_id: agencyId,
      case_id: case1.id,
      investigator_id: investigatorProfileId,
      assigned_by: adminUserId,
      assignment_scope: 'PRIMARY',
      agreed_fee: 1000.0,
      travel_allowance: 250.0,
      status: 'ACCEPTED',
      payout_status: 'PENDING',
      hardcopy_status: 'PENDING',
      is_active: true,
      assigned_at: new Date().toISOString(),
      accepted_at: new Date().toISOString(),
    });

    // Create 2 Investigation Activities
    await supabase.from('investigation_activities').insert([
      {
        agency_id: agencyId,
        case_id: case1.id,
        activity_type: 'HOSPITAL_VERIFICATION',
        task_title: 'Inspect IPD Register & Indoor Admission Notes',
        instructions: 'Check date/time of admission, casualty register entry, treating doctor signatures.',
        assigned_to_id: invUserId,
        status: 'IN_PROGRESS',
        due_date: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        created_by: adminUserId,
      },
      {
        agency_id: agencyId,
        case_id: case1.id,
        activity_type: 'CLAIMANT_INTERVIEW',
        task_title: 'Record Insured Statement & Physical Inspection',
        instructions: 'Visit residence, verify identity, photo capture of surgical scar.',
        assigned_to_id: invUserId,
        status: 'PENDING',
        due_date: new Date(Date.now() + 36 * 3600 * 1000).toISOString(),
        created_by: adminUserId,
      },
    ]);

    // Create sample case 2 (In Assignment queue)
    await supabase.from('cases').insert({
      agency_id: agencyId,
      doc_code: 'OCT26-0002',
      client_id: clientId,
      case_type: 'Cashless',
      case_type_id: caseTypeId,
      claim_no: 'CLM-2026-0945',
      normalized_claim_no: 'CLM-2026-0945',
      policy_no: 'POL-8837192',
      insured_name: 'Pooja Verma',
      hospital_name: 'Apollo Sage Hospital, Bhopal',
      hospital_city: 'Bhopal',
      hospital_state: 'Madhya Pradesh',
      claim_amount: 88000.0,
      risk_level: 'HIGH',
      status: 'ASSIGNMENT',
      owner_manager_id: adminUserId,
      data_entry_user_id: adminUserId,
      due_date: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
    });

    console.log('✓ Demo cases and field activities seeded');
  }

  console.log('\n====================================================');
  console.log('🎉 SEEDING COMPLETED SUCCESSFULLY!');
  console.log('====================================================');
  console.log('You can now log in at: http://localhost:3000/login');
  console.log('\n--- ADMIN CREDENTIALS ---');
  console.log('Agency Code: DNA');
  console.log('Username:    admin');
  console.log('Password:    Password@123');
  console.log('\n--- INVESTIGATOR CREDENTIALS ---');
  console.log('Agency Code: DNA');
  console.log('Username:    investigator1');
  console.log('Password:    Password@123');
  console.log('PWA URL:     http://localhost:3000/investigator');
  console.log('====================================================\n');
}

seed().catch((err) => {
  console.error('\nSeed script error:', err);
  process.exit(1);
});
