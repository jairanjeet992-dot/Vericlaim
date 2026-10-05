import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET() {
  const startTime = Date.now();
  let dbStatus = 'UNKNOWN';
  let latencyMs = 0;

  try {
    const supabase = createServerSupabaseClient();
    const { error } = await supabase.from('agencies').select('id').limit(1);
    latencyMs = Date.now() - startTime;
    dbStatus = error ? `ERROR: ${error.message}` : 'CONNECTED';
  } catch (err: any) {
    dbStatus = `UNREACHABLE: ${err.message}`;
    latencyMs = Date.now() - startTime;
  }

  const isHealthy = dbStatus === 'CONNECTED';

  return NextResponse.json(
    {
      status: isHealthy ? 'HEALTHY' : 'DEGRADED',
      version: '1.0.0-phase10-production',
      timestamp: new Date().toISOString(),
      uptime_seconds: process.uptime(),
      database: {
        status: dbStatus,
        latency_ms: latencyMs,
      },
      environment: process.env.NODE_ENV || 'production',
      tenancy: 'MULTI_TENANT_RLS_ISOLATION_ACTIVE',
    },
    { status: isHealthy ? 200 : 503 }
  );
}
