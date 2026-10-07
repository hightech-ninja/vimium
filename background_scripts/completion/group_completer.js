// Vomnibar completers for Chrome tab groups.
// Adapted from philc/vimium#4914.

import * as ranking from "./ranking.js";
import { Suggestion } from "./completers.js";
import { groupLandingTab } from "../tab_groups.js";

// The colors supported by chrome.tabGroups, in the order Chrome's UI lists them.
const GROUP_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];

function colorSwatch(color) {
  const cssClass = GROUP_COLORS.includes(color) ? `group-color-${color}` : "";
  return `<span class="group-color ${cssClass}"></span>`;
}

function groupTitle(group) {
  return group.title || `(${group.color})`;
}

// Returns the window's groups that match `queryTerms`, in tab strip order, each paired with its
// first tab and the window's tabs.
async function queryGroups(windowId, queryTerms) {
  const [groups, tabs] = await Promise.all([
    chrome.tabGroups.query({ windowId }),
    chrome.tabs.query({ windowId }),
  ]);
  tabs.sort((a, b) => a.index - b.index);
  return groups
    .filter((g) => ranking.matches(queryTerms, g.title ?? "", g.color))
    .map((group) => ({ group, firstTab: tabs.find((t) => t.groupId === group.id), tabs }))
    .filter(({ firstTab }) => firstTab != null)
    .sort((a, b) => a.firstTab.index - b.firstTab.index);
}

function groupSuggestion(queryTerms, group, tab, extraProperties) {
  const title = groupTitle(group);
  const suggestion = new Suggestion({
    queryTerms,
    description: "tab group",
    url: tab.url ?? tab.pendingUrl ?? "",
    title,
    deDuplicate: false,
    // Suggestions keep the order in which they're returned.
    relevancy: 1,
    ...extraProperties,
  });
  suggestion.html = `\
<div class="top-half">
  <span class="source">${colorSwatch(group.color)}${group.color}</span>
  <span class="title">${Utils.escapeHtml(title)}</span>
</div>
<div class="bottom-half">
  <span class="url">${Utils.escapeHtml(suggestion.shortenUrl())}</span>
</div>`;
  return suggestion;
}

// ZG: switch to a tab group.
export class TabGroupCompleter {
  showResultsWithNoQuery = true;

  async filter({ queryTerms, tab }) {
    const matches = await queryGroups(tab.windowId, queryTerms);
    // Go to (and show) the tab last used in the group, as zn / zN do.
    return Promise.all(matches.map(async ({ group, tabs }) => {
      const landingTab = await groupLandingTab(tabs, group.id);
      return groupSuggestion(queryTerms, group, landingTab, { tabId: landingTab.id });
    }));
  }
}

// zg, step 1: add the selected tabs to an existing group, or name a new group.
export class TabGroupAssignCompleter {
  showResultsWithNoQuery = true;

  async filter({ queryTerms, query, tab }) {
    const matches = await queryGroups(tab.windowId, queryTerms);
    const suggestions = matches.map(({ group, firstTab }) =>
      groupSuggestion(queryTerms, group, firstTab, {
        groupData: { action: "addToGroup", groupId: group.id },
      })
    );

    const name = query.trim();
    const nameExists = matches.some(({ group }) =>
      group.title?.toLowerCase() === name.toLowerCase()
    );
    if (name && !nameExists) {
      const create = new Suggestion({
        queryTerms: [],
        description: "new group",
        url: "",
        title: name,
        deDuplicate: false,
        relevancy: 0,
        groupData: { action: "createGroup", name },
      });
      create.html = `\
<div class="top-half">
  <span class="source">new group</span>
  <span class="title">${Utils.escapeHtml(`Create "${name}"`)}</span>
</div>`;
      suggestions.push(create);
    }
    return suggestions;
  }
}

// zg, step 2: choose the color of the new group.
export class TabGroupColorCompleter {
  showResultsWithNoQuery = true;

  filter({ queryTerms }) {
    const query = queryTerms.join("").toLowerCase();
    return GROUP_COLORS
      .filter((color) => color.includes(query))
      .map((color) => {
        const suggestion = new Suggestion({
          queryTerms,
          description: "color",
          url: "",
          title: color,
          deDuplicate: false,
          relevancy: 1,
          groupData: { action: "setColor", color },
        });
        suggestion.html = `\
<div class="top-half">
  <span class="source">${colorSwatch(color)}</span>
  <span class="title">${color}</span>
</div>`;
        return suggestion;
      });
  }
}
