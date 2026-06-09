let supabaseClient = null;
let supabaseInitAttempted = false;
let supabaseLastError = null;

export function shouldUseSupabase() {
  return (process.env.CMS_STORAGE_PROVIDER || "file").toLowerCase() === "supabase";
}

export function getSupabaseLastError() {
  return supabaseLastError;
}

export async function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  if (supabaseInitAttempted) return null;
  supabaseInitAttempted = true;

  if (!shouldUseSupabase()) return null;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    supabaseLastError = "Hiányzik SUPABASE_URL vagy SUPABASE_SERVICE_ROLE_KEY";
    console.error("[Supabase]", supabaseLastError);
    return null;
  }

  try {
    const { createClient } = await import("@supabase/supabase-js");
    supabaseClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    supabaseLastError = null;
    return supabaseClient;
  } catch (err) {
    supabaseLastError = err?.message || String(err);
    console.error("[Supabase] init hiba:", supabaseLastError);
    return null;
  }
}
