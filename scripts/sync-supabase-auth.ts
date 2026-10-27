export {};
/**
 * Supabase Authentication & Redirect URL Synchronization Script.
 *
 * Automatically aligns Supabase Auth Redirect URLs for subdomain isolation:
 *  - Primary Site URL: https://elts.co.id
 *  - Allowed Redirects:
 *      * https://ops.elts.co.id/**
 *      * https://client.elts.co.id/**
 *      * http://ops.localhost:3000/**
 *      * http://client.localhost:3000/**
 *      * http://localhost:3000/**
 *
 * If SUPABASE_ACCESS_TOKEN is supplied in env or via --token, this script invokes
 * the official Supabase Management API to patch the project's auth settings.
 * Otherwise, it prints the exact audit guide for manual dashboard confirmation.
 */

const PROJECT_REF = "djphrpzfayjeedaxncpq";
const SITE_URL = "https://elts.co.id";
const REDIRECT_URLS = [
  "https://ops.elts.co.id/**",
  "https://client.elts.co.id/**",
  "http://ops.localhost:3000/**",
  "http://client.localhost:3000/**",
  "http://localhost:3000/**",
];

async function main() {
  const args = process.argv.slice(2);
  const tokenArgIdx = args.indexOf("--token");
  const token =
    (tokenArgIdx !== -1 ? args[tokenArgIdx + 1] : undefined) ||
    process.env.SUPABASE_ACCESS_TOKEN;

  console.log("================================================================================");
  console.log("  eLTs Supabase Auth & Redirect URL Synchronization");
  console.log(`  Target Project Ref: ${PROJECT_REF}`);
  console.log("================================================================================\n");

  if (!token) {
    console.log("⚠️  SUPABASE_ACCESS_TOKEN not detected in environment.\n");
    console.log("To synchronize automatically via the Supabase Management API:");
    console.log("  export SUPABASE_ACCESS_TOKEN=\"sbp_...\"");
    console.log("  npx tsx scripts/sync-supabase-auth.ts\n");
    console.log("--------------------------------------------------------------------------------");
    console.log("MANUAL DASHBOARD CONFIGURATION GUIDE:");
    console.log("--------------------------------------------------------------------------------");
    console.log(`1. Open URL Configuration in Supabase Dashboard:`);
    console.log(`   👉 https://supabase.com/dashboard/project/${PROJECT_REF}/auth/url-configuration\n`);
    console.log(`2. Set Site URL:`);
    console.log(`   Site URL: ${SITE_URL}\n`);
    console.log(`3. Under 'Redirect URLs', click 'Add URL' for each of the following:`);
    for (const url of REDIRECT_URLS) {
      console.log(`   + ${url}`);
    }
    console.log("--------------------------------------------------------------------------------\n");
    return;
  }

  console.log("Connecting to Supabase Management API...");
  const endpoint = `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`;

  try {
    const response = await fetch(endpoint, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        site_url: SITE_URL,
        uri_allow_list: REDIRECT_URLS.join(","),
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`❌ Management API request failed (HTTP ${response.status}):`, errText);
      process.exit(1);
    }

    const data = await response.json();
    console.log("✅ Successfully updated Supabase Auth configuration!");
    console.log("   Site URL:", data.site_url || SITE_URL);
    console.log("   Redirect URLs:", data.uri_allow_list || REDIRECT_URLS.join(", "));
  } catch (error) {
    console.error("❌ Network error connecting to Supabase Management API:", error);
    process.exit(1);
  }
}

main().catch(console.error);
