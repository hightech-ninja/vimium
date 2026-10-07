import "./test_helper.js";
import "../../lib/url_utils.js";
import "../../background_scripts/tab_recency.js";
import * as bgUtils from "../../background_scripts/bg_utils.js";
import {
  TabGroupAssignCompleter,
  TabGroupColorCompleter,
  TabGroupCompleter,
} from "../../background_scripts/completion/group_completer.js";

const filter = (completer, queryTerms) =>
  completer.filter({ queryTerms, query: queryTerms.join(" "), tab: { windowId: 1 } });

// Group 20 comes first in the tab strip, although chrome.tabGroups.query lists it second.
const testGroups = [
  { id: 10, title: "Work", color: "blue" },
  { id: 20, title: "", color: "orange" },
];
const testTabs = [
  { id: 1, index: 0, groupId: 20, url: "http://test.com" },
  { id: 2, index: 1, groupId: 10, url: "http://work.com" },
  { id: 3, index: 2, groupId: 10, url: "http://work.com/2" },
  { id: 4, index: 3, groupId: -1, url: "http://other.com" },
];

context("TabGroupCompleter", () => {
  let queriedWindowId, recency;

  setup(() => {
    recency = [];
    stub(bgUtils.tabRecency, "init", () => Promise.resolve());
    stub(bgUtils.tabRecency, "getTabsByRecency", () => recency);
    stub(chrome, "tabGroups", {
      query: ({ windowId }) => {
        queriedWindowId = windowId;
        return testGroups;
      },
    });
    stub(chrome.tabs, "query", () => testTabs.map((t) => ({ ...t })));
  });

  should("return all groups in tab strip order when the query is empty", async () => {
    const results = await filter(new TabGroupCompleter(), []);
    assert.equal(["(orange)", "Work"], results.map((r) => r.title));
  });

  should("query the window of the requesting tab", async () => {
    await filter(new TabGroupCompleter(), []);
    assert.equal(1, queriedWindowId);
  });

  should("filter groups by title and by color", async () => {
    assert.equal(["Work"], (await filter(new TabGroupCompleter(), ["work"])).map((r) => r.title));
    assert.equal(
      ["(orange)"],
      (await filter(new TabGroupCompleter(), ["ora"])).map((r) => r.title),
    );
    assert.equal([], await filter(new TabGroupCompleter(), ["nonexistent"]));
  });

  should("point each suggestion at the group's first tab when none was used", async () => {
    const results = await filter(new TabGroupCompleter(), []);
    assert.equal([1, 2], results.map((r) => r.tabId));
  });

  should("point each suggestion at the tab last used in the group, and show its URL", async () => {
    recency = [4, 3, 2];
    const results = await filter(new TabGroupCompleter(), []);
    assert.equal([1, 3], results.map((r) => r.tabId));
    assert.equal("http://work.com/2", results[1].url);
  });

  should("show a color swatch", async () => {
    const results = await filter(new TabGroupCompleter(), []);
    assert.isTrue(results[0].html.includes("group-color-orange"));
    assert.isTrue(results[1].html.includes("group-color-blue"));
  });

  should("escape group titles", async () => {
    stub(chrome.tabGroups, "query", () => [{ id: 10, title: "<b>x</b>", color: "blue" }]);
    const results = await filter(new TabGroupCompleter(), []);
    assert.isTrue(results[0].html.includes("&lt;b&gt;x&lt;/b&gt;"));
  });
});

context("TabGroupAssignCompleter", () => {
  setup(() => {
    stub(chrome, "tabGroups", { query: () => testGroups });
    stub(chrome.tabs, "query", () => testTabs.map((t) => ({ ...t })));
  });

  should("list existing groups when the query is empty", async () => {
    const results = await filter(new TabGroupAssignCompleter(), []);
    assert.equal(
      [{ action: "addToGroup", groupId: 20 }, { action: "addToGroup", groupId: 10 }],
      results.map((r) => r.groupData),
    );
  });

  should("offer to create a new group, after the matching groups", async () => {
    const results = await filter(new TabGroupAssignCompleter(), ["wor"]);
    assert.equal(
      [{ action: "addToGroup", groupId: 10 }, { action: "createGroup", name: "wor" }],
      results.map((r) => r.groupData),
    );
  });

  should("not offer to create a group which already exists", async () => {
    for (const query of ["Work", "work"]) {
      const results = await filter(new TabGroupAssignCompleter(), [query]);
      assert.equal([{ action: "addToGroup", groupId: 10 }], results.map((r) => r.groupData));
    }
  });
});

context("TabGroupColorCompleter", () => {
  should("list all colors in Chrome's order when the query is empty", async () => {
    const results = await filter(new TabGroupColorCompleter(), []);
    assert.equal(9, results.length);
    assert.equal("grey", results[0].groupData.color);
    assert.equal("orange", results.at(-1).groupData.color);
    assert.isTrue(results.every((r) => r.groupData.action === "setColor"));
  });

  should("filter colors", async () => {
    assert.equal(
      ["blue"],
      (await filter(new TabGroupColorCompleter(), ["bl"])).map((r) => r.title),
    );
    assert.equal([], await filter(new TabGroupColorCompleter(), ["xyz"]));
  });
});
