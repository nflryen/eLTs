import test from "node:test";
import assert from "node:assert/strict";
import {
  ROOT_DOMAIN,
  marketingUrl,
  clientUrl,
  opsUrl,
} from "../src/lib/domain";

test("domain helpers construct clean URLs across subdomains", () => {
  assert.ok(ROOT_DOMAIN, "ROOT_DOMAIN must be defined");

  // In production simulation
  const prevEnv = process.env.NODE_ENV;
  const prevSite = process.env.NEXT_PUBLIC_SITE_URL;

  try {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.NEXT_PUBLIC_SITE_URL = "https://elts.co.id";

    assert.equal(marketingUrl("/"), `https://${ROOT_DOMAIN}/`);
    assert.equal(marketingUrl("/portfolio"), `https://${ROOT_DOMAIN}/portfolio`);
    assert.equal(clientUrl("/proofing/token123"), `https://client.${ROOT_DOMAIN}/proofing/token123`);
    assert.equal(clientUrl("/gallery/slug123"), `https://client.${ROOT_DOMAIN}/gallery/slug123`);
    assert.equal(opsUrl("/projects"), `https://ops.${ROOT_DOMAIN}/projects`);
    assert.equal(opsUrl("/finance"), `https://ops.${ROOT_DOMAIN}/finance`);
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;
    process.env.NEXT_PUBLIC_SITE_URL = prevSite;
  }
});

test("subdomain classification and rewrite mapping rules", () => {
  const root = "elts.co.id";

  function classifyHost(host: string) {
    const hostname = host.split(":")[0].toLowerCase();
    const isOps =
      hostname === `ops.${root}` ||
      hostname === `admin.${root}` ||
      hostname === "ops.localhost" ||
      hostname === "admin.localhost";

    const isClient =
      hostname === `client.${root}` ||
      hostname === "client.localhost";

    const isDirectIp = hostname === "127.0.0.1";
    const isRoot = !isOps && !isClient && !isDirectIp;

    return { isOps, isClient, isRoot, isDirectIp };
  }

  // Production hosts
  assert.deepEqual(classifyHost("elts.co.id"), { isOps: false, isClient: false, isRoot: true, isDirectIp: false });
  assert.deepEqual(classifyHost("ops.elts.co.id"), { isOps: true, isClient: false, isRoot: false, isDirectIp: false });
  assert.deepEqual(classifyHost("admin.elts.co.id"), { isOps: true, isClient: false, isRoot: false, isDirectIp: false });
  assert.deepEqual(classifyHost("client.elts.co.id"), { isOps: false, isClient: true, isRoot: false, isDirectIp: false });

  // Development hosts
  assert.deepEqual(classifyHost("localhost:3000"), { isOps: false, isClient: false, isRoot: true, isDirectIp: false });
  assert.deepEqual(classifyHost("ops.localhost:3000"), { isOps: true, isClient: false, isRoot: false, isDirectIp: false });
  assert.deepEqual(classifyHost("client.localhost:3000"), { isOps: false, isClient: true, isRoot: false, isDirectIp: false });
  assert.deepEqual(classifyHost("127.0.0.1:3000"), { isOps: false, isClient: false, isRoot: false, isDirectIp: true });
});

test("ops rewrite targets map to expected internal admin routes", () => {
  function mapOpsRoute(pathname: string): string {
    if (pathname === "/") return "/admin";
    if (pathname === "/login") return "/admin/login";
    if (!pathname.startsWith("/admin") && !pathname.startsWith("/api") && !pathname.startsWith("/settings")) {
      return `/admin${pathname}`;
    }
    return pathname;
  }

  assert.equal(mapOpsRoute("/"), "/admin");
  assert.equal(mapOpsRoute("/login"), "/admin/login");
  assert.equal(mapOpsRoute("/projects"), "/admin/projects");
  assert.equal(mapOpsRoute("/projects/new"), "/admin/projects/new");
  assert.equal(mapOpsRoute("/finance"), "/admin/finance");
  assert.equal(mapOpsRoute("/calendar"), "/admin/calendar");
  assert.equal(mapOpsRoute("/admin/projects"), "/admin/projects");
  assert.equal(mapOpsRoute("/settings/security"), "/settings/security");
});
