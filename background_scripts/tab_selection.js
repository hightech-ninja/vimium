// Multi-tab selection (Chrome's "highlighted" tabs), with Vim visual-mode semantics: the active tab
// is the anchor, and the selection is extended or shrunk on one side of it.
// Adapted from philc/vimium#4914.

const NO_GROUP = -1;

// zz: extend the selection to the right, or shrink it from the left if it extends left.
export async function selectNextTabForGroup({ tab, count }) {
  for (let i = 0; i < count; i++) {
    await adjustSelectionOnce(tab, 1);
  }
}

// ZZ: extend the selection to the left, or shrink it from the right if it extends right.
export async function selectPreviousTabForGroup({ tab, count }) {
  for (let i = 0; i < count; i++) {
    await adjustSelectionOnce(tab, -1);
  }
}

async function adjustSelectionOnce(tab, direction) {
  const tabs = await chrome.tabs.query({ windowId: tab.windowId });
  const highlighted = tabs.filter((t) => t.highlighted).map((t) => t.index);
  const anchor = tab.index;
  const isAhead = (i) => direction > 0 ? i > anchor : i < anchor;
  const isBehind = (i) => direction > 0 ? i < anchor : i > anchor;
  // The selected index furthest from the anchor in the given direction.
  const extreme = (dir) => dir > 0 ? Math.max(...highlighted) : Math.min(...highlighted);

  let next;
  if (highlighted.some(isBehind) && !highlighted.some(isAhead)) {
    const farthestBehind = extreme(-direction);
    next = highlighted.filter((i) => i !== farthestBehind);
  } else {
    const target = (highlighted.some(isAhead) ? extreme(direction) : anchor) + direction;
    if (target < 0 || target >= tabs.length) return;
    next = [...highlighted, target];
  }

  // The first index passed to chrome.tabs.highlight becomes the active tab, so keep the anchor
  // first.
  await chrome.tabs.highlight({
    windowId: tab.windowId,
    tabs: [anchor, ...next.filter((i) => i !== anchor)],
  });
}

// Clears a multi-tab selection: only the window's active tab stays selected.
export async function clearTabSelection(windowId) {
  const [active] = await chrome.tabs.query({ windowId, active: true });
  if (!active) return;
  await chrome.tabs.highlight({ windowId, tabs: [active.index] });
}

// Tells the window's active tab how many tabs are selected, so that Escape there can clear the
// selection (see TabSelection in vimium_frontend.js). Called whenever the selection or the active
// tab changes.
export async function notifyTabSelection(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  const active = tabs.find((t) => t.active);
  if (!active) return;
  const count = tabs.filter((t) => t.highlighted).length;
  try {
    await chrome.tabs.sendMessage(active.id, { handler: "tabSelectionChanged", count });
  } catch {
    // The tab has no content script, e.g. a chrome:// page.
  }
}

export function installTabSelectionListeners() {
  chrome.tabs.onHighlighted.addListener(({ windowId }) => notifyTabSelection(windowId));
  chrome.tabs.onActivated.addListener(({ windowId }) => notifyTabSelection(windowId));
}

// >> / << when several tabs are selected: move the selection as a block, respecting tab groups in
// the same way as moving a single tab does.
export async function moveTabSelection({ count, tab, registryEntry }) {
  const direction = registryEntry.command === "moveTabLeft" ? -1 : 1;
  for (let i = 0; i < count; i++) {
    const selected = await getSelectedUnpinned(tab.windowId);
    await moveSelectionOneStep(selected, direction);
  }
}

async function getSelectedUnpinned(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  return tabs.filter((t) => t.highlighted && !t.pinned).sort((a, b) => a.index - b.index);
}

async function moveSelectionOneStep(selected, direction) {
  const tabs = await chrome.tabs.query({ windowId: selected[0].windowId });
  const unpinned = tabs.filter((t) => !t.pinned).sort((a, b) => a.index - b.index);
  // The selection's edge in the direction of travel, and the edge opposite to it.
  const leading = direction > 0 ? selected.at(-1) : selected[0];
  const trailing = direction > 0 ? selected[0] : selected.at(-1);
  const neighbor = unpinned[unpinned.findIndex((t) => t.id === leading.id) + direction];
  if (!neighbor) return; // At the window's edge.
  // Tabs ordered starting from the leading edge.
  const fromLeadingEdge = direction > 0 ? selected.toReversed() : selected;

  const groupId = selected[0].groupId;
  const selectionInGroup = groupId !== NO_GROUP && selected.every((t) => t.groupId === groupId);
  if (selectionInGroup) {
    if (neighbor.groupId === groupId) {
      await chrome.tabs.move(neighbor.id, { index: trailing.index });
    } else {
      // The selection is at the group's edge, so leave the group. Ungrouping from the leading edge
      // means each tab is at the group's edge when ungrouped, and so Chrome leaves it in place.
      for (const t of fromLeadingEdge) await chrome.tabs.ungroup([t.id]);
    }
    return;
  }

  if (neighbor.groupId === NO_GROUP) {
    await chrome.tabs.move(neighbor.id, { index: trailing.index });
    return;
  }

  const group = await chrome.tabGroups.get(neighbor.groupId);
  if (!group.collapsed) {
    await chrome.tabs.group({ tabIds: selected.map((t) => t.id), groupId: neighbor.groupId });
    return;
  }

  // Skip over the collapsed group. Move tabs individually, leading edge first: a batch move would
  // drop the first tab between group members, so Chrome would absorb it into the group and expand
  // the group.
  const groupTabs = unpinned.filter((t) => t.groupId === neighbor.groupId);
  const farIndex = (direction > 0 ? groupTabs.at(-1) : groupTabs[0]).index;
  for (const [i, t] of fromLeadingEdge.entries()) {
    await chrome.tabs.move(t.id, { index: farIndex - direction * i });
  }
}
