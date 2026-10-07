// Commands for navigating and managing Chrome tab groups.
// Adapted from philc/vimium#4914 (and #4858).

import * as bgUtils from "./bg_utils.js";
import { moveTabSelection } from "./tab_selection.js";

const NO_GROUP = -1;

// Activates the most recently used tab in the window which satisfies `isValid`, falling back to the
// nearest such tab by index, and finally to a new ungrouped tab.
async function activateFallbackTab(tab, isValid) {
  let nextTab = await bgUtils.getLastActiveTab({
    windowId: tab.windowId,
    excludeTabId: tab.id,
    isValid,
  });
  if (!nextTab) {
    const tabs = await chrome.tabs.query({ windowId: tab.windowId });
    nextTab = tabs.find((t) => t.index > tab.index && isValid(t)) ||
      tabs.findLast((t) => t.index < tab.index && isValid(t));
  }
  if (!nextTab) {
    // Open the same page as the createTab command (by default Vimium's new tab page, rather than
    // Chrome's, where Vimium can't run).
    const url = bgUtils.getNewTabUrl();
    const tabConfig = { windowId: tab.windowId };
    if (url != UrlUtils.chromeNewTabUrl) tabConfig.url = url;
    nextTab = await chrome.tabs.create(tabConfig);
    // The new tab must not join a group, or collapsing that group would hide it again.
    if (nextTab.groupId != null && nextTab.groupId != NO_GROUP) {
      await chrome.tabs.ungroup([nextTab.id]);
    }
  }
  await chrome.tabs.update(nextTab.id, { active: true });
}

// Collapses the current tab's group, and moves to the last active tab outside of that group.
// Chrome won't collapse a group which contains the active tab, so we switch tabs first.
export async function collapseTabGroup({ tab }) {
  if (tab.groupId == NO_GROUP) return;
  const groupId = tab.groupId;
  // Activating a tab in another collapsed group would expand that group, so avoid those tabs.
  const collapsed = await chrome.tabGroups.query({ windowId: tab.windowId, collapsed: true });
  const collapsedIds = new Set(collapsed.map((g) => g.id));
  await activateFallbackTab(tab, (t) => t.groupId !== groupId && !collapsedIds.has(t.groupId));
  await chrome.tabGroups.update(groupId, { collapsed: true });
}

// Collapses every expanded group in the window, and moves to the last active ungrouped tab.
export async function collapseAllTabGroups({ tab }) {
  const groups = await chrome.tabGroups.query({ windowId: tab.windowId, collapsed: false });
  if (tab.groupId != NO_GROUP) {
    await activateFallbackTab(tab, (t) => t.groupId === NO_GROUP);
  }
  await Promise.all(groups.map((g) => chrome.tabGroups.update(g.id, { collapsed: true })));
}

export function previousTabGroup({ count, tab }) {
  return goToTabGroup(tab, -(count ?? 1));
}

export function nextTabGroup({ count, tab }) {
  return goToTabGroup(tab, count ?? 1);
}

// The tab to activate when entering a group: the group's most recently used tab, so that leaving a
// group and coming back returns to the same tab. Falls back to the group's first tab (e.g. after a
// browser restart, since TabRecency isn't kept across restarts).
export async function groupLandingTab(tabs, groupId) {
  const groupTabs = tabs.filter((t) => t.groupId === groupId).sort((a, b) => a.index - b.index);
  await bgUtils.tabRecency.init();
  const groupTabsById = new Map(groupTabs.map((t) => [t.id, t]));
  for (const id of bgUtils.tabRecency.getTabsByRecency()) {
    if (groupTabsById.has(id)) return groupTabsById.get(id);
  }
  return groupTabs[0];
}

// Moves `steps` groups to the right (positive) or left (negative) of the current tab, wrapping
// around the window, expands that group and activates its landing tab.
async function goToTabGroup(tab, steps) {
  const tabs = await chrome.tabs.query({ windowId: tab.windowId });
  tabs.sort((a, b) => a.index - b.index);
  // Group IDs in tab strip order.
  const groupIds = [...new Set(tabs.map((t) => t.groupId).filter((id) => id != NO_GROUP))];
  if (groupIds.length == 0) return;
  let position;
  if (tab.groupId != NO_GROUP) {
    position = groupIds.indexOf(tab.groupId) + steps;
  } else {
    // From an ungrouped tab, the first step goes to the nearest group in that direction.
    const groupsBefore = new Set(
      tabs.filter((t) => t.index < tab.index && t.groupId != NO_GROUP).map((t) => t.groupId),
    ).size;
    position = steps > 0 ? groupsBefore + steps - 1 : groupsBefore + steps;
  }
  const n = groupIds.length;
  const groupId = groupIds[((position % n) + n) % n];
  if (groupId === tab.groupId) return;
  const target = await groupLandingTab(tabs, groupId);
  await chrome.tabGroups.update(groupId, { collapsed: false });
  await chrome.tabs.update(target.id, { active: true });
}

// Moves an unpinned tab (or the current multi-tab selection) left or right, respecting group
// boundaries: a tab at a group's edge first leaves the group, a tab next to an expanded group
// joins it, and collapsed groups are skipped over as a whole.
export async function moveTab({ count, tab, registryEntry }) {
  const direction = registryEntry.command === "moveTabLeft" ? -1 : 1;
  const tabs = await chrome.tabs.query({ windowId: tab.windowId });
  const selectedCount = tabs.filter((t) => t.highlighted && !t.pinned).length;
  if (selectedCount > 1) return moveTabSelection({ count, tab, registryEntry });

  for (let i = 0; i < count; i++) {
    await moveTabOneStep(tab, direction);
    tab = await chrome.tabs.get(tab.id);
  }
}

async function moveTabOneStep(tab, direction) {
  const tabs = await chrome.tabs.query({ windowId: tab.windowId });
  const unpinned = tabs.filter((t) => !t.pinned).sort((a, b) => a.index - b.index);
  const pos = unpinned.findIndex((t) => t.id === tab.id);
  if (pos === -1) return;

  if (tab.groupId !== NO_GROUP) {
    const groupTabs = unpinned.filter((t) => t.groupId === tab.groupId);
    const atEdge = direction > 0 ? tab.id === groupTabs.at(-1).id : tab.id === groupTabs[0].id;
    if (atEdge) {
      // Ungrouping a tab at the group's edge leaves it at its current index, just outside the
      // group.
      await chrome.tabs.ungroup([tab.id]);
    } else {
      await chrome.tabs.move(tab.id, { index: unpinned[pos + direction].index });
    }
    return;
  }

  const neighbor = unpinned[pos + direction];
  if (!neighbor) return; // At the window's edge.

  if (neighbor.groupId === NO_GROUP) {
    await chrome.tabs.move(tab.id, { index: neighbor.index });
    return;
  }

  const group = await chrome.tabGroups.get(neighbor.groupId);
  if (!group.collapsed) {
    // Chrome keeps the tab at its current (adjacent) position when adding it to the group.
    await chrome.tabs.group({ tabIds: [tab.id], groupId: neighbor.groupId });
    return;
  }

  // Skip over the whole collapsed group.
  const groupTabs = unpinned.filter((t) => t.groupId === neighbor.groupId);
  const farEdge = direction > 0 ? groupTabs.at(-1) : groupTabs[0];
  const beyond = unpinned[unpinned.findIndex((t) => t.id === farEdge.id) + direction];
  // Moving the tab out of its slot shifts the indices of the tabs it passes over by one, hence
  // `- direction`.
  const index = beyond ? beyond.index - direction : farEdge.index;
  await chrome.tabs.move(tab.id, { index });
}
