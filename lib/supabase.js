import { createClient } from "@supabase/supabase-js";
import ws from "ws";

let supabaseClient = null;
let supabaseInitAttempted = false;
let supabaseLastError = null;

export function shouldUseSupabase() {
  const provider = (process.env.CMS_STORAGE_PROVIDER || "").toLowerCase().trim();
  if (provider === "supabase") return true;
  // Auto-detect: ha megvannak a Supabase env-k, de elmaradt a CMS_STORAGE_PROVIDER
  const url = process.env.SUPABASE_URL?.trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)?.trim();
  return !!(url && key);
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
    if (!globalThis.WebSocket) {
      globalThis.WebSocket = ws;
    }

    supabaseClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: ws }
    });
    supabaseLastError = null;
    return supabaseClient;
  } catch (err) {
    supabaseLastError = err?.message || String(err);
    console.error("[Supabase] init hiba:", supabaseLastError);
    return null;
  }
}
