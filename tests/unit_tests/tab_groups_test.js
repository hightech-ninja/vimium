import "./test_helper.js";
import "../../lib/settings.js";
import "../../lib/url_utils.js";
import * as bgUtils from "../../background_scripts/bg_utils.js";
import {
  collapseAllTabGroups,
  collapseTabGroup,
  moveTab,
  nextTabGroup,
  previousTabGroup,
} from "../../background_scripts/tab_groups.js";

const makeTab = (id, index, groupId, props = {}) => ({
  id,
  index,
  groupId,
  windowId: 1,
  pinned: false,
  highlighted: false,
  ...props,
});

context("moveTab (>> / <<)", () => {
  let calls;

  setup(() => {
    calls = [];
    stub(chrome.tabs, "move", (id, { index }) => calls.push(["move", id, index]));
    stub(chrome.tabs, "group", ({ tabIds, groupId }) => calls.push(["group", tabIds, groupId]));
    stub(chrome.tabs, "ungroup", (ids) => calls.push(["ungroup", ids]));
  });

  const move = (tab, command) => moveTab({ count: 1, tab, registryEntry: { command } });

  should("move past an ungrouped neighbor", async () => {
    const tabs = [makeTab(1, 0, -1), makeTab(2, 1, -1)];
    stub(chrome.tabs, "query", () => tabs);
    await move(tabs[0], "moveTabRight");
    assert.equal([["move", 1, 1]], calls);
  });

  should("join an expanded group next to the tab", async () => {
    const tabs = [makeTab(1, 0, -1), makeTab(2, 1, 99)];
    stub(chrome.tabs, "query", () => tabs);
    stub(chrome, "tabGroups", { get: () => ({ collapsed: false }) });
    await move(tabs[0], "moveTabRight");
    assert.equal([["group", [1], 99]], calls);
  });

  should("leave the group when at the group's edge", async () => {
    const tabs = [makeTab(1, 0, 99), makeTab(2, 1, 99), makeTab(3, 2, -1)];
    stub(chrome.tabs, "query", () => tabs);
    await move(tabs[1], "moveTabRight");
    assert.equal([["ungroup", [2]]], calls);
  });

  should("move within the group when not at its edge", async () => {
    const tabs = [makeTab(1, 0, 99), makeTab(2, 1, 99)];
    stub(chrome.tabs, "query", () => tabs);
    await move(tabs[0], "moveTabRight");
    assert.equal([["move", 1, 1]], calls);
  });

  should("skip over a collapsed group", async () => {
    const tabs = [makeTab(1, 0, -1), makeTab(2, 1, 99), makeTab(3, 2, 99), makeTab(4, 3, -1)];
    stub(chrome.tabs, "query", () => tabs);
    stub(chrome, "tabGroups", { get: () => ({ collapsed: true }) });
    await move(tabs[0], "moveTabRight");
    assert.equal([["move", 1, 2]], calls);
  });

  should("skip over a collapsed group at the right edge of the window", async () => {
    const tabs = [makeTab(1, 0, -1), makeTab(2, 1, 99), makeTab(3, 2, 99)];
    stub(chrome.tabs, "query", () => tabs);
    stub(chrome, "tabGroups", { get: () => ({ collapsed: true }) });
    await move(tabs[0], "moveTabRight");
    assert.equal([["move", 1, 2]], calls);
  });

  should("skip over a collapsed group at the left edge of the window", async () => {
    const tabs = [makeTab(1, 0, 99), makeTab(2, 1, 99), makeTab(3, 2, -1)];
    stub(chrome.tabs, "query", () => tabs);
    stub(chrome, "tabGroups", { get: () => ({ collapsed: true }) });
    await move(tabs[2], "moveTabLeft");
    assert.equal([["move", 3, 0]], calls);
  });

  should("not move past pinned tabs", async () => {
    const tabs = [makeTab(1, 0, -1, { pinned: true }), makeTab(2, 1, -1)];
    stub(chrome.tabs, "query", () => tabs);
    await move(tabs[1], "moveTabLeft");
    assert.equal([], calls);
  });
});

context("collapseTabGroup (za)", () => {
  let activatedId, collapsedGroupId;

  setup(async () => {
    activatedId = null;
    collapsedGroupId = null;
    stub(bgUtils.tabRecency, "init", () => Promise.resolve());
    stub(chrome.tabs, "update", (id) => activatedId = id);
    stub(chrome, "tabGroups", {
      query: () => [],
      update: (id) => collapsedGroupId = id,
    });
    await Settings.load();
  });

  teardown(() => Settings.clear());

  should("switch to the last active tab outside the group, then collapse it", async () => {
    const tabs = [makeTab(1, 0, -1), makeTab(2, 1, 99), makeTab(3, 2, -1)];
    stub(chrome.tabs, "query", () => tabs);
    stub(bgUtils.tabRecency, "getTabsByRecency", () => [2, 1, 3]);
    await collapseTabGroup({ tab: tabs[1] });
    assert.equal(1, activatedId);
    assert.equal(99, collapsedGroupId);
  });

  should("fall back to the nearest tab outside the group", async () => {
    const tabs = [makeTab(1, 0, 99), makeTab(2, 1, 99), makeTab(3, 2, -1)];
    stub(chrome.tabs, "query", () => tabs);
    stub(bgUtils.tabRecency, "getTabsByRecency", () => []);
    await collapseTabGroup({ tab: tabs[1] });
    assert.equal(3, activatedId);
  });

  should("not switch to a tab in another collapsed group", async () => {
    const tabs = [makeTab(1, 0, 50), makeTab(2, 1, 99), makeTab(3, 2, -1)];
    stub(chrome.tabs, "query", () => tabs);
    stub(chrome.tabGroups, "query", () => [{ id: 50 }]);
    stub(bgUtils.tabRecency, "getTabsByRecency", () => [2, 1, 3]);
    await collapseTabGroup({ tab: tabs[1] });
    assert.equal(3, activatedId);
  });

  should("open the configured new tab page when every tab is in the group", async () => {
    await Settings.set("newTabDestination", Settings.newTabDestinations.vimiumNewTabPage);
    const tabs = [makeTab(1, 0, 99)];
    let createArgs;
    stub(chrome.tabs, "query", () => tabs);
    stub(bgUtils.tabRecency, "getTabsByRecency", () => []);
    stub(chrome.tabs, "create", (args) => {
      createArgs = args;
      return { id: 42, groupId: -1 };
    });
    await collapseTabGroup({ tab: tabs[0] });
    assert.equal(Settings.vimiumNewTabPageUrl, createArgs.url);
    assert.equal(42, activatedId);
    assert.equal(99, collapsedGroupId);
  });

  should("ungroup the new tab if Chrome put it into a group", async () => {
    const tabs = [makeTab(1, 0, 99)];
    let ungrouped;
    stub(chrome.tabs, "query", () => tabs);
    stub(bgUtils.tabRecency, "getTabsByRecency", () => []);
    stub(chrome.tabs, "create", () => ({ id: 42, groupId: 99 }));
    stub(chrome.tabs, "ungroup", (ids) => ungrouped = ids);
    await collapseTabGroup({ tab: tabs[0] });
    assert.equal([42], ungrouped);
  });

  should("do nothing for an ungrouped tab", async () => {
    await collapseTabGroup({ tab: makeTab(1, 0, -1) });
    assert.equal(null, activatedId);
    assert.equal(null, collapsedGroupId);
  });
});

context("collapseAllTabGroups (zA)", () => {
  let activatedId, collapsedGroupIds;

  setup(() => {
    activatedId = null;
    collapsedGroupIds = [];
    stub(bgUtils.tabRecency, "init", () => Promise.resolve());
    stub(chrome.tabs, "update", (id) => activatedId = id);
    stub(chrome, "tabGroups", {
      query: ({ collapsed }) => {
        assert.equal(false, collapsed);
        return [{ id: 10 }, { id: 20 }];
      },
      update: (id) => collapsedGroupIds.push(id),
    });
  });

  should("collapse every expanded group, and stay on an ungrouped current tab", async () => {
    const tabs = [makeTab(1, 0, -1), makeTab(2, 1, 10), makeTab(3, 2, -1)];
    stub(chrome.tabs, "query", () => tabs);
    await collapseAllTabGroups({ tab: tabs[2] });
    assert.equal([10, 20], collapsedGroupIds);
    assert.equal(null, activatedId);
  });

  should("switch to the last active ungrouped tab when the current tab is grouped", async () => {
    const tabs = [makeTab(1, 0, -1), makeTab(2, 1, 10), makeTab(3, 2, -1)];
    stub(chrome.tabs, "query", () => tabs);
    stub(bgUtils.tabRecency, "getTabsByRecency", () => [2, 1, 3]);
    await collapseAllTabGroups({ tab: tabs[1] });
    assert.equal(1, activatedId);
    assert.equal([10, 20], collapsedGroupIds);
  });
});

context("nextTabGroup / previousTabGroup (zn / zN)", () => {
  let activatedId, expandedGroupId, recency;
  // Groups: 10 = [1, 2], ungrouped 3, 20 = [4, 5].
  const tabs = [
    makeTab(1, 0, 10),
    makeTab(2, 1, 10),
    makeTab(3, 2, -1),
    makeTab(4, 3, 20),
    makeTab(5, 4, 20),
  ];

  setup(() => {
    activatedId = null;
    expandedGroupId = null;
    recency = [];
    stub(bgUtils.tabRecency, "init", () => Promise.resolve());
    stub(bgUtils.tabRecency, "getTabsByRecency", () => recency);
    stub(chrome.tabs, "query", () => tabs.map((t) => ({ ...t })));
    stub(chrome.tabs, "update", (id) => activatedId = id);
    stub(chrome, "tabGroups", {
      update: (id, { collapsed }) => {
        assert.equal(false, collapsed);
        expandedGroupId = id;
      },
    });
  });

  should("go to the first tab of the next group when none was used", async () => {
    await nextTabGroup({ tab: tabs[0] });
    assert.equal(4, activatedId);
    assert.equal(20, expandedGroupId);
  });

  should("go to the first tab of the previous group when none was used", async () => {
    await previousTabGroup({ tab: tabs[4] });
    assert.equal(1, activatedId);
    assert.equal(10, expandedGroupId);
  });

  should("wrap around", async () => {
    await nextTabGroup({ tab: tabs[3] });
    assert.equal(1, activatedId);
    await previousTabGroup({ tab: tabs[0] });
    assert.equal(4, activatedId);
  });

  should("go to the nearest group from an ungrouped tab", async () => {
    await nextTabGroup({ tab: tabs[2] });
    assert.equal(4, activatedId);
    await previousTabGroup({ tab: tabs[2] });
    assert.equal(1, activatedId);
  });

  should("go to the tab last used in the group", async () => {
    recency = [2, 5, 1, 4];
    await previousTabGroup({ tab: tabs[3] });
    assert.equal(2, activatedId);
    await nextTabGroup({ tab: tabs[1] });
    assert.equal(5, activatedId);
  });

  should("return to the tab it left from: zn, then zN", async () => {
    // On tab 2 (group 10), zn goes to group 20. Tab 2 is then the most recent tab outside group 20.
    recency = [5, 2, 4, 1];
    await nextTabGroup({ tab: tabs[1] });
    assert.equal(5, activatedId);
    recency = [5, 2, 4, 1];
    await previousTabGroup({ tab: tabs[4] });
    assert.equal(2, activatedId);
  });

  should("ignore recently used tabs which have left the group", async () => {
    recency = [2, 1];
    const moved = tabs.map((t) => t.id == 2 ? { ...t, groupId: -1 } : { ...t });
    stub(chrome.tabs, "query", () => moved);
    await previousTabGroup({ tab: moved[3] });
    assert.equal(1, activatedId);
  });

  should("skip groups with a count, wrapping around", async () => {
    const withThirdGroup = [...tabs, makeTab(6, 5, 30)];
    stub(chrome.tabs, "query", () => withThirdGroup.map((t) => ({ ...t })));
    await nextTabGroup({ tab: tabs[0], count: 2 });
    assert.equal(6, activatedId);
    await nextTabGroup({ tab: tabs[3], count: 2 });
    assert.equal(1, activatedId);
    await previousTabGroup({ tab: tabs[0], count: 2 });
    assert.equal(4, activatedId);
    await nextTabGroup({ tab: tabs[2], count: 2 });
    assert.equal(6, activatedId);
  });

  should("do nothing when the count leads back to the current group", async () => {
    await nextTabGroup({ tab: tabs[0], count: 2 });
    assert.equal(null, activatedId);
  });

  should("do nothing without groups", async () => {
    stub(chrome.tabs, "query", () => [makeTab(1, 0, -1), makeTab(2, 1, -1)]);
    await nextTabGroup({ tab: makeTab(1, 0, -1) });
    assert.equal(null, activatedId);
  });
});
