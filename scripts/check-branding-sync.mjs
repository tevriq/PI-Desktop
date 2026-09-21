#!/usr/bin/env node
/**
 * Personal-fork application identity check.
 *
 * Usage:
 *   node scripts/check-branding-sync.mjs
 *   pnpm check:branding
 *
 * This fork carries its own application ID while keeping upstream's display
 * name. The ID has to be restated in four places because neither the
 * electron-builder configuration inside `apps/desktop/package.json` nor the
 * plain `.mjs` development launcher can import the TypeScript constant, and the
 * unsigned first-launch helper is a shell script. An upstream merge can
 * therefore desynchronize them without any test noticing, which is exactly the
 * class of mistake this gate prevents.
 *
 * Enforced:
 *   1. `packages/shared/src/protocol.ts` `APP_ID` equals
 *      `apps/desktop/package.json` `build.appId`.
 *   2. `APP_NAME` equals `build.productName`.
 *   3. `scripts/dev-electron.mjs` `DEV_BUNDLE_ID` is `<APP_ID>.dev`.
 *   4. `apps/desktop/PI-Desktop-macOS-open.command` `EXPECTED_BUNDLE_ID`
 *      is `APP_ID`.
 *   5. The macOS release feed and the updater's "view releases" link point at
 *      the fork, not at the upstream repository. A packaged build that kept the
 *      upstream feed would silently install the upstream release over itself.
 *
 * The identity is frozen by design: macOS TCC grants, Keychain items,
 * LaunchServices registration, and the code-signing designated requirement are
 * all keyed to the bundle identifier. Decide it once; after that, only the
 * display name and the publish target are expected to move.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const failures = [];

const read = (relPath) => {
  try {
    return readFileSync(path.join(root, relPath), "utf8");
  } catch {
    failures.push(`${relPath}: file is missing`);
    return null;
  }
};

const readJson = (relPath) => {
  const raw = read(relPath);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    failures.push(`${relPath}: not valid JSON (${error.message})`);
    return null;
  }
};

/** First capture group of `pattern` in `text`, or null. */
const capture = (text, pattern) => (text ? (text.match(pattern)?.[1] ?? null) : null);

const PROTOCOL_PATH = "packages/shared/src/protocol.ts";
const DESKTOP_PACKAGE_PATH = "apps/desktop/package.json";
const DEV_LAUNCHER_PATH = "scripts/dev-electron.mjs";
const MAC_OPEN_HELPER_PATH = "apps/desktop/PI-Desktop-macOS-open.command";
const UPDATER_PATH = "apps/desktop/electron/main/updater.ts";

const protocolSource = read(PROTOCOL_PATH);
const desktopPackage = readJson(DESKTOP_PACKAGE_PATH);
const devLauncherSource = read(DEV_LAUNCHER_PATH);
const macOpenHelperSource = read(MAC_OPEN_HELPER_PATH);
const updaterSource = read(UPDATER_PATH);

const appId = capture(protocolSource, /export const APP_ID = "([^"]+)"/);
const appName = capture(protocolSource, /export const APP_NAME = "([^"]+)"/);
const devBundleId = capture(devLauncherSource, /const DEV_BUNDLE_ID = "([^"]+)"/);
const helperBundleId = capture(
  macOpenHelperSource,
  /readonly EXPECTED_BUNDLE_ID="([^"]+)"/,
);
const releasesUrl = capture(updaterSource, /RELEASES_URL = "([^"]+)"/);

if (!appId) failures.push(`${PROTOCOL_PATH}: APP_ID is missing or not a literal`);
if (!appName) failures.push(`${PROTOCOL_PATH}: APP_NAME is missing or not a literal`);

if (appId && desktopPackage) {
  const buildAppId = desktopPackage.build?.appId;
  if (buildAppId !== appId) {
    failures.push(
      `${DESKTOP_PACKAGE_PATH}: build.appId is \`${buildAppId}\` but ${PROTOCOL_PATH} declares \`${appId}\`.`,
    );
  }
}

if (appName && desktopPackage) {
  const productName = desktopPackage.build?.productName;
  if (productName !== appName) {
    failures.push(
      `${DESKTOP_PACKAGE_PATH}: build.productName is \`${productName}\` but ${PROTOCOL_PATH} declares \`${appName}\`.`,
    );
  }
}

if (appId && devBundleId !== `${appId}.dev`) {
  failures.push(
    `${DEV_LAUNCHER_PATH}: DEV_BUNDLE_ID is \`${devBundleId}\` but the development host of \`${appId}\` must be \`${appId}.dev\`.`,
  );
}

if (appId && helperBundleId !== appId) {
  failures.push(
    `${MAC_OPEN_HELPER_PATH}: EXPECTED_BUNDLE_ID is \`${helperBundleId}\` but the packaged bundle is \`${appId}\`.`,
  );
}

// The About panel renders this string straight from the bundle. This fork is a
// derivative work, so the upstream attribution has to survive an upstream merge
// that could otherwise overwrite it with the fork owner's name.
const copyright = desktopPackage?.build?.copyright;
if (typeof copyright !== "string" || !copyright.includes("vastsa")) {
  failures.push(
    `${DESKTOP_PACKAGE_PATH}: build.copyright must keep the upstream attribution ("vastsa").`,
  );
}

// The fork must not be reachable by the upstream update feed. `vastsa` is the
// upstream owner; a personal fork repoints `build.publish` at its own repo.
const UPSTREAM_MARKERS = ["vastsa/PI-Desktop", "vastsa"];
const publishEntries = Array.isArray(desktopPackage?.build?.publish)
  ? desktopPackage.build.publish
  : [];
for (const entry of publishEntries) {
  const target = `${entry?.owner ?? ""}/${entry?.repo ?? ""}`;
  if (UPSTREAM_MARKERS.some((marker) => target.includes(marker))) {
    failures.push(
      `${DESKTOP_PACKAGE_PATH}: build.publish still targets the upstream repository (\`${target}\`); a packaged fork build would install the upstream release over itself.`,
    );
  }
}

if (releasesUrl && UPSTREAM_MARKERS.some((marker) => releasesUrl.includes(marker))) {
  failures.push(
    `${UPDATER_PATH}: RELEASES_URL still points at the upstream repository (\`${releasesUrl}\`).`,
  );
}

if (failures.length > 0) {
  console.error("Application identity check failed:\n");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  console.error(
    "\nThe application ID is duplicated on purpose. Update every copy above,",
  );
  console.error(
    "keep the display name in step, then re-run: pnpm check:branding",
  );
  process.exit(1);
}

console.log(
  `Application identity check passed (${appName} / ${appId}, dev ${devBundleId}).`,
);
