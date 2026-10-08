import type { NextConfig } from "next";

const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const validationImages = storageUrl ? new URL("/storage/v1/object/public/validation-exercise-images/**", storageUrl) : null;

const nextConfig: NextConfig = {
  images: { remotePatterns: validationImages ? [validationImages] : [] },
  // Separate build state for the isolated organization fixture server.
  ...(process.env.ACTIVITEE_ORGANIZATION_FIXTURE
    ? { distDir: process.env.ACTIVITEE_ORGANIZATION_FIXTURE === "build" ? ".next-organization-build" : ".next-organization-fixture" }
    : {}),
};

export default nextConfig;
