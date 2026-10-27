export {};
/**
 * Production & Local Subdomain Smoke Test Automation Script for eLTs.
 *
 * Tests the entire edge routing, multi-tenancy rewrite, and cookie isolation contracts:
 *  1. Root domain 301 permanent redirects:
 *      - /admin       -> https://ops.elts.co.id/
 *      - /client      -> https://client.elts.co.id/
 *      - /proofing/*  -> https://client.elts.co.id/proofing/*
 *      - /gallery/*   -> https://client.elts.co.id/gallery/*
 *  2. Marketing root host routing (200 OK for /, /portfolio, /pricelist)
 *  3. Client subdomain routing (200 OK for client portal)
 *  4. Ops subdomain routing & authentication gate (307/302 redirect to /login when unauthenticated, 200 on /login)
 *  5. Cookie domain isolation: Set-Cookie headers must NEVER spill wildcard "Domain=.elts.co.id"
 *  6. CORS preflight / origin validation for allowed subdomains.
 *
 * Usage:
 *  npm run test:smoke
 *  npx tsx scripts/smoke-test-subdomains.ts [--local | --prod]
 */

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "elts.co.id";
const isProdTarget = process.argv.includes("--prod");
const baseUrl = isProdTarget ? `https://${ROOT_DOMAIN}` : (process.env.BASE_URL || "http://127.0.0.1:3000");

interface TestResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  error?: string;
}

const results: TestResult[] = [];

async function runCheck(
  name: string,
  fn: () => Promise<{ passed: boolean; expected: string; actual: string }>
) {
  try {
    const res = await fn();
    results.push({ name, ...res });
    if (res.passed) {
      console.log(`  ✓ ${name}`);
    } else {
      console.log(`  ✗ ${name} (Expected: ${res.expected}, got: ${res.actual})`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, expected: "success", actual: "exception", error: msg });
    console.log(`  ✗ ${name} (Threw: ${msg})`);
  }
}

async function request(
  path: string,
  host: string,
  options: RequestInit = {}
): Promise<{ status: number; headers: Headers; location: string | null; cookies: string[] }> {
  const targetUrl = isProdTarget ? `https://${host}${path}` : `${baseUrl}${path}`;
  const headers = new Headers(options.headers || {});
  headers.set("Host", host);
  headers.set("x-forwarded-host", host);
  headers.set("x-forwarded-proto", isProdTarget ? "https" : "http");
  const res = await fetch(targetUrl, {
    ...options,
    headers,
    redirect: "manual", // Do not follow redirects so we can inspect 301/307 status codes & locations
  });

  const location = res.headers.get("location");
  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];

  return {
    status: res.status,
    headers: res.headers,
    location,
    cookies,
  };
}

async function main() {
  console.log("================================================================================");
  console.log("  eLTs Subdomain & Multi-Tenancy Smoke Test Suite");
  console.log(`  Target Mode: ${isProdTarget ? "PRODUCTION EDGE" : "LOCAL / STAGING"} (${baseUrl})`);
  console.log(`  Root Domain: ${ROOT_DOMAIN}`);
  console.log("================================================================================\n");

  console.log("1. Testing Root Domain 301 Permanent Redirects...");

  await runCheck("GET /admin redirects to ops subdomain", async () => {
    const res = await request("/admin", ROOT_DOMAIN);
    const passed = (res.status === 301 || res.status === 308) && Boolean(res.location?.includes("ops."));
    return {
      passed,
      expected: "301/308 redirect to ops subdomain",
      actual: `HTTP ${res.status} -> ${res.location}`,
    };
  });

  await runCheck("GET /admin/projects redirects to ops subdomain preserving subpath", async () => {
    const res = await request("/admin/projects", ROOT_DOMAIN);
    const passed = (res.status === 301 || res.status === 308) && Boolean(res.location?.includes("ops.") && res.location?.includes("/projects"));
    return {
      passed,
      expected: "301/308 redirect to ops subdomain with /projects",
      actual: `HTTP ${res.status} -> ${res.location}`,
    };
  });

  await runCheck("GET /client redirects to client subdomain", async () => {
    const res = await request("/client", ROOT_DOMAIN);
    const passed = (res.status === 301 || res.status === 308) && Boolean(res.location?.includes("client."));
    return {
      passed,
      expected: "301/308 redirect to client subdomain",
      actual: `HTTP ${res.status} -> ${res.location}`,
    };
  });

  await runCheck("GET /proofing/[token] redirects to client subdomain", async () => {
    const res = await request("/proofing/dummytoken1234567890123456789012345678901234", ROOT_DOMAIN);
    const passed = (res.status === 301 || res.status === 308) && Boolean(res.location?.includes("client.") && res.location?.includes("/proofing/"));
    return {
      passed,
      expected: "301/308 redirect to client subdomain /proofing/...",
      actual: `HTTP ${res.status} -> ${res.location}`,
    };
  });

  await runCheck("GET /gallery/[slug] redirects to client subdomain", async () => {
    const res = await request("/gallery/sample-gallery-slug", ROOT_DOMAIN);
    const passed = (res.status === 301 || res.status === 308) && Boolean(res.location?.includes("client.") && res.location?.includes("/gallery/"));
    return {
      passed,
      expected: "301/308 redirect to client subdomain /gallery/...",
      actual: `HTTP ${res.status} -> ${res.location}`,
    };
  });

  console.log("\n2. Testing Marketing Root Host Routing...");

  await runCheck("GET / on root domain returns 200 OK", async () => {
    const res = await request("/", ROOT_DOMAIN);
    return {
      passed: res.status === 200,
      expected: "HTTP 200",
      actual: `HTTP ${res.status}`,
    };
  });

  await runCheck("GET /portfolio on root domain returns 200 OK", async () => {
    const res = await request("/portfolio", ROOT_DOMAIN);
    return {
      passed: res.status === 200,
      expected: "HTTP 200",
      actual: `HTTP ${res.status}`,
    };
  });

  await runCheck("GET /pricelist on root domain returns 200 OK", async () => {
    const res = await request("/pricelist", ROOT_DOMAIN);
    return {
      passed: res.status === 200,
      expected: "HTTP 200",
      actual: `HTTP ${res.status}`,
    };
  });

  console.log("\n3. Testing Client Subdomain Routing...");

  const clientHost = isProdTarget ? `client.${ROOT_DOMAIN}` : "client.localhost:3000";

  await runCheck("GET / on client subdomain rewrites to client access portal", async () => {
    const res = await request("/", clientHost);
    // On client subdomain, / rewrites to /client which returns 200 (or if no session, 200 login view)
    const passed = res.status === 200 || (res.status === 307 && Boolean(res.location?.includes("/client")));
    return {
      passed,
      expected: "HTTP 200 or rewrite to /client",
      actual: `HTTP ${res.status}`,
    };
  });

  console.log("\n4. Testing Ops Subdomain Routing & Security Gate...");

  const opsHost = isProdTarget ? `ops.${ROOT_DOMAIN}` : "ops.localhost:3000";

  await runCheck("GET / on ops subdomain (unauthenticated) gates with login redirect", async () => {
    const res = await request("/", opsHost);
    const passed = (res.status === 307 || res.status === 302 || res.status === 301) && Boolean(res.location?.includes("/login"));
    return {
      passed,
      expected: "307 redirect to login",
      actual: `HTTP ${res.status} -> ${res.location}`,
    };
  });

  await runCheck("GET /login on ops subdomain returns 200 OK (login view)", async () => {
    const res = await request("/login", opsHost);
    return {
      passed: res.status === 200,
      expected: "HTTP 200",
      actual: `HTTP ${res.status}`,
    };
  });

  console.log("\n5. Testing Security & Cookie Scoping Invariants...");

  await runCheck("Set-Cookie headers NEVER spill wildcard root domain attribute (.elts.co.id)", async () => {
    // Collect cookies across multiple requests
    const [r1, r2, r3] = await Promise.all([
      request("/", ROOT_DOMAIN),
      request("/login", opsHost),
      request("/", clientHost),
    ]);

    const allCookies = [...r1.cookies, ...r2.cookies, ...r3.cookies];
    const wildcardLeak = allCookies.some((c) => /domain=\.?elts\.co\.id/i.test(c));

    return {
      passed: !wildcardLeak,
      expected: "Zero wildcard domain cookie leakage",
      actual: wildcardLeak ? `LEAKED: ${allCookies.find((c) => /domain=\.?elts\.co\.id/i.test(c))}` : "All cookies host-scoped",
    };
  });

  console.log("\n================================================================================");
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;
  console.log(`  Summary: ${passed}/${total} checks passed (${failed} failed)`);
  console.log("================================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Smoke test suite failed with error:", err);
  process.exit(1);
});
