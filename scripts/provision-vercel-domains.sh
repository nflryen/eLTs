#!/usr/bin/env bash
# Provision Vercel Subdomains for eLTs Studio
# Usage: ./scripts/provision-vercel-domains.sh
set -euo pipefail

echo "========================================================"
echo "  Vercel Subdomain Provisioning for eLTs Visual Studio  "
echo "========================================================"

if ! command -v vercel &>/dev/null; then
  echo "Vercel CLI not found. Please run: npm i -g vercel"
  exit 1
fi

echo "1. Checking Vercel Authentication..."
if ! vercel whoami &>/dev/null; then
  echo "⚠️  Vercel CLI is not authenticated."
  echo "Please authenticate using one of the following:"
  echo "  a) vercel login"
  echo "  b) export VERCEL_TOKEN=\"...\""
  echo ""
  echo "After authenticating, rerun this script to provision:"
  echo "  vercel domains add ops.elts.co.id"
  echo "  vercel domains add client.elts.co.id"
  exit 0
fi

echo "2. Adding subdomain: ops.elts.co.id"
vercel domains add ops.elts.co.id || true

echo "3. Adding subdomain: client.elts.co.id"
vercel domains add client.elts.co.id || true

echo "4. Current Project Domains:"
vercel domains ls || true

echo "✅ Domain provisioning routine completed."
