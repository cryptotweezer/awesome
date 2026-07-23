import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function signOut(request: Request) {
  const { origin, searchParams } = new URL(request.url);
  const supabase = await createClient();
  await supabase.auth.signOut();

  const error = searchParams.get("error");
  const target = error ? `/login?error=${error}` : "/login";
  return NextResponse.redirect(`${origin}${target}`);
}

export async function GET(request: Request) {
  return signOut(request);
}

export async function POST(request: Request) {
  return signOut(request);
}
