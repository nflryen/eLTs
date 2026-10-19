/**
 * Account provisioning is deliberately manual.
 *
 * The previous development seed embedded credentials and could grant admin
 * membership to an existing account. Never run a database seed against a live
 * photography business without a separate, reviewed fixture workflow.
 *
 * This command reads no environment values, contacts no service, and changes no
 * accounts or records. Existing credentials remain unchanged.
 */
function refuseDefaultAccountCreation(): never {
  console.error(
    [
      "Elts. does not create default administrator accounts or gallery PINs.",
      "",
      "For initial setup:",
      "1. Apply the reviewed Supabase migrations to the intended project.",
      "2. Create a uniquely credentialed user through Supabase Auth.",
      "3. An authorized owner must grant that user membership in public.admins.",
      "4. Create customers and galleries through the protected admin workflow.",
      "",
      "For automated fixtures, use a separate disposable test database and",
      "explicit test credentials; hash gallery PINs with",
      "src/lib/security/credentials.ts. Never use a fast hash labeled scrypt.",
      "",
      "No environment values were read and no records were changed.",
      "See docs/setup.md and docs/project-status-2026-09-19.md.",
    ].join("\n"),
  );
  process.exit(1);
}

refuseDefaultAccountCreation();
