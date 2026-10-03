import React from 'react';
import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext, getAgencyBranding } from '@/modules/tenancy/service';
import { PwaRegister } from '@/app/pwa-register';
import { AgencyShell } from './components/agency-shell';

export default async function AgencyShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const context = await getUserContext(supabase, user.id);
  if (!context) {
    redirect('/login?error=user_not_found');
  }

  if (!context.agency.is_active) {
    redirect('/login?error=agency_suspended');
  }

  const branding = await getAgencyBranding(supabase, context.agency_id);

  return (
    <>
      <PwaRegister />
      <AgencyShell
        context={context}
        planTier={branding?.plan_tier || 'free'}
        branding={branding}
      >
        {children}
      </AgencyShell>
    </>
  );
}
