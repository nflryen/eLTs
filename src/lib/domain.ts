/**
 * Subdomain and multi-tenancy URL helper for eLTs Studio.
 *
 * Supports both production (elts.co.id, ops.elts.co.id, client.elts.co.id)
 * and local development (localhost:3000, ops.localhost:3000, client.localhost:3000).
 */

export const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "elts.co.id";

/**
 * Returns a fully-qualified URL for a specific subdomain and path.
 */
export function getDomainUrl(
  subdomain?: "ops" | "client" | "admin" | null,
  path: string = ""
): string {
  const normalizedPath = path ? (path.startsWith("/") ? path : `/${path}`) : "";
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
  const isLocal =
    process.env.NODE_ENV !== "production" ||
    siteUrl.includes("localhost") ||
    siteUrl.includes("127.0.0.1");

  if (!subdomain) {
    if (isLocal) {
      return `http://localhost:3000${normalizedPath}`;
    }
    return `https://${ROOT_DOMAIN}${normalizedPath}`;
  }

  const prefix = subdomain === "admin" ? "ops" : subdomain;

  if (isLocal) {
    return `http://${prefix}.localhost:3000${normalizedPath}`;
  }

  return `https://${prefix}.${ROOT_DOMAIN}${normalizedPath}`;
}

export const marketingUrl = (path: string = "") => getDomainUrl(null, path);
export const clientUrl = (path: string = "") => getDomainUrl("client", path);
export const opsUrl = (path: string = "") => getDomainUrl("ops", path);
