import {
  readAppSource,
  readSettingsSource,
  readMainSource,
  readSharedTypesSource,
} from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  protocolSource,
  typesSource,
  updaterSource,
  mainSource,
  menuSource,
  apiSource,
  bannerSource,
  releaseNotesDialogSource,
  settingsSource,
  appSource,
  stylesSource,
  pkgSource,
  buildReleaseSource,
  releaseWorkflowSource,
  enSource,
  zhSource,
  changelogSource,
] = await Promise.all([
  read("../../../packages/shared/src/protocol.ts"),
  readSharedTypesSource(),
  read("../electron/main/updater.ts"),
  readMainSource(),
  read("../electron/main/application-menu.ts"),
  read("../src/lib/api.ts"),
  read("../src/components/UpdateBanner.tsx"),
  read("../src/components/ReleaseNotesDialog.tsx"),
  readSettingsSource(),
  readAppSource(),
  loadStyles(),
  read("../package.json"),
  read("../../../scripts/build-desktop-release.mjs"),
  read("../../../.github/workflows/release.yml"),
  read("../../../packages/i18n/src/locales/en/index.ts"),
  read("../../../packages/i18n/src/locales/zh-CN/index.ts"),
  read("../../../packages/shared/src/changelog.ts"),
]);

test("update IPC channels are declared and whitelisted for the preload bridge", () => {
  for (const channel of [
    "updatesGetState",
    "updatesCheck",
    "updatesDownload",
    "updatesInstall",
    "updatesOpenReleases",
    "updatesState",
  ]) {
    assert.match(protocolSource, new RegExp(`${channel}:`), channel);
  }
  // The whitelist derives from the IPC map, so declaring is allowing.
  assert.match(protocolSource, /\.\.\.Object\.values\(IPC\.invoke\)/);
  assert.match(protocolSource, /\.\.\.Object\.values\(IPC\.event\)/);
  assert.match(typesSource, /export type UpdateState = \{/);
  assert.match(
    typesSource,
    /releaseNotes\?: string/,
    "UpdateState carries localized product notes from Main",
  );
});

test("main process registers update handlers and the auto-check lifecycle", () => {
  for (const channel of [
    "IPC.invoke.updatesGetState",
    "IPC.invoke.updatesCheck",
    "IPC.invoke.updatesDownload",
    "IPC.invoke.updatesInstall",
    "IPC.invoke.updatesOpenReleases",
  ]) {
    assert.ok(mainSource.includes(channel), channel);
  }
  assert.match(mainSource, /new AppUpdaterController\(/);
  assert.match(mainSource, /isPackaged:\s*!isDevelopmentBuild/);
  assert.match(mainSource, /updater\.startAutoCheck\(\)/);
  assert.match(
    mainSource,
    /await ensureWindow\(\);[\s\S]*updater\.startAutoCheck\(\)/,
    "auto-check starts after the first window exists, never on the boot await path",
  );
  assert.match(mainSource, /updater\.dispose\(\)/);
});

test("updater gates delivery mode by platform and delivery policy", () => {
  // This fork ships with updates off outright. The platform matrix below stays
  // intact so a build that turns them back on resolves delivery modes exactly
  // as upstream does.
  assert.match(
    updaterSource,
    /const UPDATES_DISABLED = true/,
    "the personal fork ships with updates off",
  );
  assert.match(updaterSource, /if \(UPDATES_DISABLED\) return "disabled"/);
  // Packaged macOS, Windows NSIS, and Linux AppImage use in-app delivery.
  // Dev builds are disabled outright.
  assert.match(updaterSource, /if \(!isPackaged\) return "disabled"/);
  assert.match(updaterSource, /win32.*in-app|in-app.*win32/s);
  assert.match(
    updaterSource,
    /PORTABLE_EXECUTABLE_FILE[\s\S]*distribution === "zip"/,
  );
  assert.match(updaterSource, /piDistribution/);
  assert.match(updaterSource, /platform === "darwin"[\s\S]*return "in-app"/);
  assert.match(updaterSource, /APPIMAGE/);
  assert.match(updaterSource, /autoInstallOnAppQuit = true/);
  assert.match(
    updaterSource,
    /allowPrerelease = false/,
    "prerelease installs must still track the stable GitHub latest release",
  );
  assert.match(updaterSource, /quitAndInstall/);
  assert.match(
    updaterSource,
    /private installRequested = false/,
    "the install request is latched so the shutdown path can see it",
  );
  assert.match(
    updaterSource,
    /isInstallingUpdate\(\): boolean/,
    "the shutdown path must be able to ask whether this quit is an update restart",
  );
  assert.match(
    updaterSource,
    /this\.installRequested = true;[\s\S]*?autoUpdater\.quitAndInstall\(/,
    "the latch must be set before quitAndInstall spawns the installer",
  );
  assert.match(
    updaterSource,
    /state\.status === "downloaded"[\s\S]*return this\.state/,
  );
  assert.match(updaterSource, /autoUpdater\.on\("error"/);
  // The "view releases" fallback must track the same repository the update feed
  // publishes to. Repointing `build.publish` at a fork while leaving this URL on
  // another repository would send users to releases they cannot install.
  const feedTarget = (() => {
    const publish = JSON.parse(pkgSource).build.publish[0];
    return `${publish.owner}/${publish.repo}`;
  })();
  assert.ok(
    updaterSource.includes(`github.com/${feedTarget}/releases`),
    "releases fallback URL matches the configured publish repository",
  );
  assert.match(
    updaterSource,
    /formatChangelogNotes/,
    "in-app localized notes attach from the shared changelog catalog",
  );
  assert.match(
    updaterSource,
    /releaseNotes: this\.notesFor/,
    "discovery and download events attach releaseNotes on UpdateState",
  );
  assert.match(
    updaterSource,
    /refreshReleaseNotes/,
    "locale changes re-resolve notes without a new feed check",
  );
  assert.match(
    updaterSource,
    /AUTO_CHECK_TIMEOUT_MS = 8_000/,
    "auto GitHub checks must not wait for Chromium's ~60s socket timeout",
  );
  assert.match(updaterSource, /raceWithTimeout/);
  assert.match(updaterSource, /UPDATE_CHECK_TIMEOUT/);
  assert.match(
    updaterSource,
    /status === "checking"[\s\S]*status: "idle"/,
    "a timed-out auto-check must leave checking so the next interval can run",
  );
});

test("renderer exposes the updates API, banner and settings row", () => {
  assert.match(apiSource, /updatesGetState:/);
  assert.match(apiSource, /updatesCheck:/);
  assert.match(apiSource, /updatesInstall:/);
  assert.match(apiSource, /onUpdateState:/);
  assert.match(bannerSource, /updates\.restart/);
  assert.match(bannerSource, /updates\.viewRelease/);
  assert.match(bannerSource, /updates\.whatsNew/);
  assert.match(bannerSource, /releaseNotes/);
  assert.match(bannerSource, /availableVersion}:\$\{update\.status/);
  assert.match(bannerSource, /className="update-notice"/);
  assert.match(bannerSource, /role="progressbar"/);
  assert.match(settingsSource, /<UpdatesRow currentVersion=/);
  assert.match(settingsSource, /update-settings-notes/);
  assert.match(settingsSource, /updates\.whatsNew/);
  assert.match(settingsSource, /updates\.releaseNotes/);
  assert.match(settingsSource, /<ReleaseNotesDialog/);
  assert.match(releaseNotesDialogSource, /CHANGELOG\[locale\]/);
  assert.match(releaseNotesDialogSource, /new Intl\.DateTimeFormat\(locale,/);
  assert.match(releaseNotesDialogSource, /role="dialog"/);
  assert.match(releaseNotesDialogSource, /aria-modal="true"/);
  assert.match(releaseNotesDialogSource, /data-release-version/);
  assert.match(releaseNotesDialogSource, /event\.key === "Escape"/);
  assert.match(
    appSource,
    /<section className="main-pane">[\s\S]*?<UpdateBanner \/>/,
    "chat update notice is anchored inside the main pane",
  );
  assert.match(
    stylesSource,
    /\.update-notice \{[\s\S]*?position: absolute;[\s\S]*?top: 54px;/,
  );
  assert.doesNotMatch(
    bannerSource,
    /fixed bottom-4 right-4/,
    "update notice must not occupy the composer edge",
  );
  assert.match(appSource, /case "checkForUpdates"/);
});

test("check-for-updates is reachable from the application menu", () => {
  assert.match(protocolSource, /"checkForUpdates",/);
  assert.match(menuSource, /checkForUpdates/);
  for (const source of [enSource, zhSource]) {
    assert.match(source, /checkForUpdates:/);
    assert.match(source, /updates: \{/);
    for (const key of [
      "upToDate",
      "downloading",
      "downloaded",
      "restart",
      "whatsNew",
      "releaseNotes",
      "closeReleaseNotes",
      "currentBadge",
      "availableBadge",
    ]) {
      assert.match(source, new RegExp(`${key}:`), key);
    }
  }
});

test("packaging publishes an electron-updater feed for GitHub Releases", () => {
  const pkg = JSON.parse(pkgSource);
  assert.ok(pkg.dependencies["electron-updater"], "electron-updater dependency");
  assert.equal(pkg.build.publish[0].provider, "github");
  // A repackaged fork must never point its update feed at the upstream
  // repository: a local stable build would then download and silently install
  // the upstream release over itself. `pnpm check:branding` asserts the same
  // rule against the releases URL so the two cannot drift apart.
  assert.notEqual(
    `${pkg.build.publish[0].owner}/${pkg.build.publish[0].repo}`,
    "vastsa/PI-Desktop",
    "update feed must not target the upstream repository",
  );
  assert.equal(pkg.build.publish[0].repo, "PI-Desktop");
  const macTargets = pkg.build.mac.target.map((entry) => entry.target);
  assert.ok(macTargets.includes("zip"), "mac zip target (Squirrel.Mac feed)");
  // electron-builder must never self-publish (implicit tag publishing would
  // fail on the missing token and race the softprops release step).
  for (const script of ["dist:mac", "dist:win", "dist:linux"]) {
    assert.match(
      pkg.scripts[script],
      /--publish never|build-desktop-release\.mjs/,
      script,
    );
  }
  assert.match(pkg.scripts.dist, /build-desktop-release\.mjs/);
  assert.equal(pkg.build.linux.executableName, "pi-desktop");
  const linuxTargets = pkg.build.linux.target.map((entry) => entry.target);
  assert.deepEqual(
    linuxTargets,
    ["AppImage", "deb", "rpm"],
    "Linux release targets",
  );
  // Scoped package name is not a valid deb/rpm package or file name.
  assert.equal(pkg.build.deb.packageName, "pi-desktop");
  assert.equal(pkg.build.rpm.packageName, "pi-desktop");
  assert.ok(!pkg.build.deb.artifactName.includes("${name}"), "deb artifactName");
  assert.equal(
    pkg.build.rpm.artifactName,
    "pi-desktop-${version}-${arch}.${ext}",
    "rpm artifactName",
  );
  assert.deepEqual(
    pkg.build.rpm.fpm,
    ["--rpm-rpmbuild-define", "_build_id_links none"],
    "rpm build-id configuration",
  );
  // GitHub asset URLs mangle spaces; keep Windows artifact names space-free.
  assert.equal(pkg.build.nsis.artifactName, "PI-Desktop-Setup-${version}.${ext}");
  const winTargets = pkg.build.win.target.map((entry) => entry.target);
  assert.deepEqual(winTargets, ["nsis", "zip", "portable"], "Windows release targets");
  assert.equal(pkg.build.portable.artifactName, "PI-Desktop-Portable-${version}.${ext}", "portable artifact name");
  assert.equal(
    pkg.build.win.artifactName,
    "PI-Desktop-Portable-${version}.${ext}",
  );
  assert.equal(pkg.build.extraMetadata.piDistribution, "installed");
  assert.match(pkg.scripts["dist:win"], /build-desktop-release\.mjs win/);
  assert.match(buildReleaseSource, /"--win",\s*"nsis"/);
  assert.match(buildReleaseSource, /"--win",\s*"zip"/);
  assert.match(buildReleaseSource, /"--win",\s*"portable"/);
  assert.match(buildReleaseSource, /piDistribution=portable/);
  assert.match(buildReleaseSource, /"--publish",\s*"never"/);
  assert.match(buildReleaseSource, /piDistribution=installed/);
  assert.match(buildReleaseSource, /piDistribution=zip/);
  assert.match(
    buildReleaseSource,
    /shell:\s*process\.platform === "win32"/,
    "Windows must launch the pnpm.cmd shim through a shell",
  );
  // The upload step must carry every updater feed, and the release publishes
  // all platforms unfiltered (D126/D285).
  assert.match(releaseWorkflowSource, /release\/\*\.zip/);
  assert.match(releaseWorkflowSource, /release\/\*\.rpm/);
  assert.match(releaseWorkflowSource, /release\/latest\*\.yml/);
  assert.match(releaseWorkflowSource, /files: dist\/\*/);
});

test("shared shipped-locale changelog is the in-app notes source of truth", () => {
  assert.match(changelogSource, /export const CHANGELOG/);
  assert.match(changelogSource, /formatChangelogNotes/);
  assert.match(changelogSource, /"zh-CN"/);
  assert.match(changelogSource, /"zh-TW"/);
  assert.match(changelogSource, /version: "0\.2\.7"/);
  assert.match(
    mainSource,
    /getLocale:\s*\(\)\s*=>\s*updaterLocale/,
    "Main supplies product locale to the updater for note selection",
  );
  assert.match(mainSource, /updater\.refreshReleaseNotes\(\)/);
  assert.match(stylesSource, /\.update-notice-notes/);
  assert.match(stylesSource, /\.update-settings-notes/);
});
