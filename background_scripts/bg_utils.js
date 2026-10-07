import { TabRecency } from "./tab_recency.js";

// We're using browser.runtime to determine the browser name and version for Firefox. That API is
// only available on the background page. We're not using window.navigator because it's unreliable.
// Sometimes browser vendors will provide fake values, like when `privacy.resistFingerprinting` is
// enabled on `about:config` of Firefox.
export function isFirefox() {
  // We want this browser check to also cover Firefox variants, like LibreWolf. See #3773.
  // We could also just check browserInfo.name against Firefox and Librewolf.
  return globalThis.browser?.runtime.getURL("").startsWith("moz") ?? false;
}

export async function getFirefoxVersion() {
  return isFirefox() ? (await browser.runtime.getBrowserInfo()).version : null;
}

// The URL to open in a new tab, according to the user's "New tab page" setting.
export function getNewTabUrl() {
  const destination = Settings.get("newTabDestination");
  const customUrl = Settings.get("newTabCustomUrl");
  if (destination == Settings.newTabDestinations.vimiumNewTabPage) {
    return Settings.vimiumNewTabPageUrl;
  } else if (destination == Settings.newTabDestinations.customUrl && customUrl.length > 0) {
    return customUrl;
  } else {
    return UrlUtils.chromeNewTabUrl;
  }
}

// TODO(philc): tabRecency imports bg_utils. We should resovle the cycle for the sake of clarity.
export const tabRecency = new TabRecency();
tabRecency.init();

// Returns the most recently active tab in `windowId` which satisfies `isValid`, or null. The tab
// `excludeTabId` (typically the current tab) is never returned.
export async function getLastActiveTab({ windowId, excludeTabId, isValid }) {
  await tabRecency.init();
  const tabs = await chrome.tabs.query({ windowId });
  const tabsById = new Map(tabs.map((t) => [t.id, t]));
  for (const id of tabRecency.getTabsByRecency()) {
    if (id === excludeTabId) continue;
    const candidate = tabsById.get(id);
    if (candidate && (!isValid || isValid(candidate))) return candidate;
  }
  return null;
}
