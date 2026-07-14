const VERSION_MAJOR = 0;
const VERSION_MINOR = 9;
const VERSION_PATCH_BASE = 0;
const VERSION_BASE_COMMIT_COUNT = 117;

function parseCommitCount(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : VERSION_BASE_COMMIT_COUNT;
}

const currentCommitCount = parseCommitCount(__APP_GIT_COMMIT_COUNT__);
const derivedPatch = Math.max(
  VERSION_PATCH_BASE,
  VERSION_PATCH_BASE + (currentCommitCount - VERSION_BASE_COMMIT_COUNT)
);

export const APP_VERSION = `${VERSION_MAJOR}.${VERSION_MINOR}.${derivedPatch}`;
export const APP_COPYRIGHT = `Copyright ${new Date().getFullYear()} James Skon`;
