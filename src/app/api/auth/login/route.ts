import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { AuthService } from '@/modules/auth/service';
import { LoginFormSchema } from '@/modules/auth/schema';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = LoginFormSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || 'Invalid form input' },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const authService = new AuthService(supabase);

    const result = await authService.resolveLoginCredentials(parsed.data);

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          isSuspended: result.isSuspended,
          totpRequired: result.user?.totpRequired,
        },
        { status: result.isSuspended ? 403 : 401 }
      );
    }

    // Sign in with internal synthetic email
    if (result.syntheticEmail) {
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: result.syntheticEmail,
        password: parsed.data.password,
      });

      if (signInError) {
        return NextResponse.json(
          { success: false, error: 'Authentication failed. Please verify your credentials.' },
          { status: 401 }
        );
      }

      return NextResponse.json({
        success: true,
        redirectUrl: '/dashboard',
        user: result.user,
      });
    }

    return NextResponse.json(
      { success: false, error: 'Could not resolve authentication identity' },
      { status: 500 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Server error occurred during sign in' },
      { status: 500 }
    );
  }
}
