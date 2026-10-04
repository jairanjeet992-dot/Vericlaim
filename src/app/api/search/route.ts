import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserContext } from '@/modules/tenancy/service';
import { RbacService } from '@/modules/rbac/service';
import { SearchEngine, GlobalSearchQuerySchema } from '@/modules/search';

export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const context = await getUserContext(supabase, user.id);
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rbacService = new RbacService(supabase);
  const userPerms = await rbacService.getEffectivePermissions(context.agency_id, context.id);

  const { searchParams } = new URL(req.url);
  const rawParams = {
    q: searchParams.get('q') || '',
    limit: searchParams.get('limit') || 20,
    offset: searchParams.get('offset') || 0,
    client_id: searchParams.get('client_id') || undefined,
  };

  const parsed = GlobalSearchQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid search parameters', details: parsed.error.format() }, { status: 400 });
  }

  try {
    const searchEngine = new SearchEngine(supabase);
    const results = await searchEngine.search({
      agency_id: context.agency_id,
      query: parsed.data.q,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      actor_user_id: context.id,
      caller_scope: context.scope,
      client_id: parsed.data.client_id,
    });

    return NextResponse.json({ success: true, ...results });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
