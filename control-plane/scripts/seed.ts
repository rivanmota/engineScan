// Seeds a dev Organization + ApiKey into the Firestore emulator so the
// dashboard and the Python agent have something to authenticate with out of
// the box (there's no signup flow yet). Run with `npm run seed` while the
// emulator is running (FIRESTORE_EMULATOR_HOST must be set, e.g. via
// `.env.local`).
import dotenv from "dotenv";
import path from "path";
import { v4 as uuidv4 } from "uuid";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { getDb } from "../src/lib/firestore";

async function main() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    console.error(
      "FIRESTORE_EMULATOR_HOST is not set. Refusing to seed a non-emulator Firestore database."
    );
    process.exit(1);
  }

  const db = getDb();

  const orgRef = db.collection("organizations").doc();
  await orgRef.set({
    name: "Dev Organization",
    createdAt: new Date(),
  });

  const apiKey = `devkey_${uuidv4()}`;
  const apiKeyRef = db.collection("apiKeys").doc();
  await apiKeyRef.set({
    key: apiKey,
    organizationId: orgRef.id,
    createdAt: new Date(),
  });

  console.log("Seeded dev organization:");
  console.log(`  organizationId: ${orgRef.id}`);
  console.log(`  X-Api-Key:      ${apiKey}`);
  console.log("\nUse this header to authenticate dashboard/API requests, e.g.:");
  console.log(`  curl -H "X-Api-Key: ${apiKey}" http://localhost:4000/campaigns`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
