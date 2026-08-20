/**
 * Convex ↔ Clerk trust. CLERK_JWT_ISSUER_DOMAIN is set in the Convex
 * dashboard (SETUP.md step 4); the "convex" JWT template must carry
 * org_id, org_slug and org_role claims — convex/lib/functions.ts reads them.
 */
const authConfig = {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};

export default authConfig;
