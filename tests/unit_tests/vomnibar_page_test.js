import * as testHelper from "./test_helper.js";
import { withPromise } from "./test_helper.js";
import "../../tests/unit_tests/test_chrome_stubs.js";
import {
  CommandCompleter,
  MultiCompleter,
  Suggestion,
} from "../../background_scripts/completion/completers.js";
import * as vomnibarPage from "../../pages/vomnibar_page.js";
import * as userSearchEngines from "../../background_scripts/user_search_engines.js";
import { Commands } from "../../background_scripts/commands.js";
import { filterCompleter } from "./completion/completers_test.js";

function newKeyEvent(properties) {
  return Object.assign(
    {
      type: "keydown",
      key: "a",
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      stopImmediatePropagation: function () {},
      preventDefault: function () {},
    },
    properties,
  );
}

context("vomnibar page", () => {
  let ui;
  setup(async () => {
    await testHelper.jsdomStub("pages/vomnibar_page.html");
    stub(
      chrome.runtime,
      "sendMessage",
      withPromise((message) => {
        if (message.handler == "filterCompletions") {
          return [];
        }
      }),
    );
    vomnibarPage.reset();
    await vomnibarPage.activate();
    ui = vomnibarPage.ui;
  });

  should("hide when escape is pressed", async () => {
    ui.setQuery("www.example.com");
    // Here we assert that the dialog has been reset when esc is pressed, which happens as part of
    // hiding the dialog. It would be better to check more directly that the dialog was hidden, but
    // jacking into the channels for this are not worthwhile for this test.
    await ui.onKeyEvent(newKeyEvent({ key: "Escape" }));
    assert.equal("", ui.input.value);
  });

  should("edit a completion's URL when ctrl-enter is pressed", async () => {
    stub(
      chrome.runtime,
      "sendMessage",
      withPromise((message) => {
        if (message.handler == "filterCompletions") {
          const s = new Suggestion({ url: "http://hello.com" });
          return [s];
        }
      }),
    );
    await ui.update();
    await ui.onKeyEvent(newKeyEvent({ type: "keydown", key: "up" }));
    // TODO(philc): Why does this need to be lowercase enter?
    await ui.onKeyEvent(newKeyEvent({ type: "keypress", ctrlKey: true, key: "enter" }));
    assert.equal("http://hello.com", ui.input.value);
  });

  should("open a URL-like query when enter is pressed", async () => {
    ui.setQuery("www.example.com");
    let handler = null;
    let url = null;
    stub(
      chrome.runtime,
      "sendMessage",
      withPromise((message) => {
        handler = message.handler;
        url = message.url;
      }),
    );
    await ui.onKeyEvent(newKeyEvent({ type: "keypress", key: "Enter" }));
    ui.onHidden();
    assert.equal("openUrlInCurrentTab", handler);
    assert.equal("www.example.com", url);
  });

  should("search for a non-URL query when enter is pressed", async () => {
    ui.setQuery("example");
    let handler = null;
    let query = null;
    stub(
      chrome.runtime,
      "sendMessage",
      withPromise((message) => {
        handler = message.handler;
        query = message.query;
      }),
    );
    await ui.onKeyEvent(newKeyEvent({ type: "keypress", key: "Enter" }));
    ui.onHidden();
    assert.equal("launchSearchQuery", handler);
    assert.equal("example", query);
  });

  // This test covers #4396.
  should("not treat javascript keywords as user-defined search engines", () => {
    ui.setQuery("constructor "); // "constructor" is a built-in JS property
    ui.onInput();
    // The query should not be treated as a user search engine.
    assert.equal("constructor ", ui.input.value);
  });

  should("use custom search engine when enter is pressed before completions arrive", async () => {
    userSearchEngines.set("e: https://www.example.com/search?q=%s Example");

    let capturedUrl = null;
    stub(
      chrome.runtime,
      "sendMessage",
      withPromise((message) => {
        // Return a never-resolving promise for filterCompletions to simulate the race condition where
        // the user hits Enter before the background page responds with completions.
        if (message.handler === "filterCompletions") return new Promise(() => {});
        if (message.handler === "openUrlInCurrentTab") capturedUrl = message.url;
      }),
    );

    ui.setQuery("e hello");
    ui.onInput();
    // completions is empty because the filterCompletions stub, above, is unresolved.
    assert.equal(0, ui.completions.length);

    await ui.onKeyEvent(newKeyEvent({ type: "keypress", key: "Enter" }));
    ui.onHidden();

    assert.equal("https://www.example.com/search?q=hello", capturedUrl);
  });

  should("create command suggestions with correct HTML for key bindings", async () => {
    await Commands.loadKeyMappings("");
    const multiCompleter = new MultiCompleter([new CommandCompleter()]);
    const suggestions = await filterCompleter(multiCompleter, ["go", "tab", "right"]);
    stub(chrome.runtime, "sendMessage", withPromise(() => suggestions));
    await ui.updateCompletions();
    assert.equal(1, ui.completionList.childNodes.length);
    const keys = Array.from(ui.completionList.querySelectorAll(".key")).map((x) => x.textContent);
    assert.equal(["K", "gt"], keys);
  });
});

context("vomnibar page, tab groups", () => {
  let ui, sentMessages;

  setup(async () => {
    await testHelper.jsdomStub("pages/vomnibar_page.html");
    sentMessages = [];
    stub(
      chrome.runtime,
      "sendMessage",
      withPromise((message) => {
        sentMessages.push(message);
        if (message.handler != "filterCompletions") return;
        if (message.completerName == "tabGroupAssign") {
          return [{ html: "", groupData: { action: "createGroup", name: message.query } }];
        } else if (message.completerName == "tabGroupColors") {
          return [{ html: "", groupData: { action: "setColor", color: "blue" } }];
        }
        return [];
      }),
    );
    vomnibarPage.reset();
    await vomnibarPage.activate({ completer: "tabGroupAssign", selectFirst: true });
    ui = vomnibarPage.ui;
  });

  should("create a group in two steps: name, then color", async () => {
    ui.setQuery("News");
    await ui.update();
    await ui.onKeyEvent(newKeyEvent({ type: "keypress", key: "Enter" }));
    assert.equal("tabGroupColors", ui.completerName);
    assert.equal("", ui.input.value);

    await ui.onKeyEvent(newKeyEvent({ type: "keypress", key: "Enter" }));
    ui.onHidden();
    const created = sentMessages.find((m) => m.handler == "createTabGroup");
    assert.equal({ name: "News", color: "blue" }, Utils.pick(created, ["name", "color"]));
  });

  should(
    "not act on outdated suggestions when enter is pressed before new ones arrive",
    async () => {
      // The suggestions shown are for the empty query: an existing group.
      ui.completions = [{ html: "", groupData: { action: "addToGroup", groupId: 1 } }];
      ui.completionsQuery = "";
      ui.setQuery("News");
      await ui.onKeyEvent(newKeyEvent({ type: "keypress", key: "Enter" }));
      assert.equal("tabGroupColors", ui.completerName);
      assert.isFalse(sentMessages.some((m) => m.handler == "addTabsToGroup"));
    },
  );
});

context("vomnibar page, direct selection with modifier+digit", () => {
  let ui, sentMessages, results;

  const urlSuggestions = (count) =>
    Array.from({ length: count }, (_, i) => ({ html: `r${i + 1}`, url: `http://${i + 1}.com` }));

  // A keydown for modifier+digit, e.g. jumpKey("2", { ctrlKey: true }).
  const jumpKey = (digit, modifiers) =>
    newKeyEvent({ type: "keydown", key: digit, code: `Digit${digit}`, ...modifiers });

  const jumpKeyLabels = () =>
    Array.from(ui.completionList.querySelectorAll(".jump-key")).map((el) => el.textContent);

  const sentMessage = (handler) => sentMessages.find((m) => m.handler == handler);

  setup(async () => {
    await testHelper.jsdomStub("pages/vomnibar_page.html");
    await Settings.onLoaded();
    sentMessages = [];
    results = urlSuggestions(3);
    stub(
      chrome.runtime,
      "sendMessage",
      withPromise((message) => {
        sentMessages.push(message);
        if (message.handler == "filterCompletions") return results;
      }),
    );
    vomnibarPage.reset();
    await vomnibarPage.activate();
    ui = vomnibarPage.ui;
  });

  teardown(async () => {
    await Settings.clear();
  });

  should("number fewer than 10 results from 1", () => {
    assert.equal(["1", "2", "3"], jumpKeyLabels());
    assert.isTrue(ui.completionList.classList.contains("jump-keys"));
  });

  should("number only the first 10 results, using 0 for the 10th", async () => {
    results = urlSuggestions(12);
    await ui.update();
    assert.equal(["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"], jumpKeyLabels());
    assert.equal(12, ui.completionList.children.length);
  });

  should("renumber the results when they change", async () => {
    results = urlSuggestions(12);
    await ui.update();
    results = urlSuggestions(2);
    await ui.update();
    assert.equal(["1", "2"], jumpKeyLabels());
  });

  should("open the result with that number in the current tab", async () => {
    await ui.onKeyEvent(jumpKey("2", { ctrlKey: true }));
    ui.onHidden();
    assert.equal(
      { handler: "openUrlInCurrentTab", url: "http://2.com" },
      Utils.pick(sentMessage("openUrlInCurrentTab"), ["handler", "url"]),
    );
  });

  should("open the 10th result with 0", async () => {
    results = urlSuggestions(12);
    await ui.update();
    await ui.onKeyEvent(jumpKey("0", { ctrlKey: true }));
    ui.onHidden();
    assert.equal("http://10.com", sentMessage("openUrlInCurrentTab").url);
  });

  should("open the result in a new tab when shift is added", async () => {
    await ui.onKeyEvent(jumpKey("1", { ctrlKey: true, shiftKey: true }));
    ui.onHidden();
    assert.equal("http://1.com", sentMessage("openUrlInNewTab").url);
  });

  should("open the result in a new tab when the Vomnibar was opened for a new tab", async () => {
    ui.setForceNewTab(true);
    await ui.onKeyEvent(jumpKey("1", { ctrlKey: true }));
    ui.onHidden();
    assert.equal("http://1.com", sentMessage("openUrlInNewTab").url);
  });

  should("leave digits typed without the modifier to the query", async () => {
    let prevented = false;
    const event = jumpKey("1", { preventDefault: () => prevented = true });
    await ui.onKeyEvent(event);
    assert.isFalse(prevented);
    assert.equal(undefined, sentMessage("openUrlInCurrentTab"));
  });

  should("ignore digits with another modifier or an extra modifier", async () => {
    for (
      const modifiers of [{ altKey: true }, { metaKey: true }, { ctrlKey: true, altKey: true }]
    ) {
      let prevented = false;
      await ui.onKeyEvent(jumpKey("1", { ...modifiers, preventDefault: () => prevented = true }));
      assert.isFalse(prevented);
    }
    assert.equal(undefined, sentMessage("openUrlInCurrentTab"));
  });

  should("ignore the keypress event for modifier+digit", async () => {
    await ui.onKeyEvent(jumpKey("1", { type: "keypress", ctrlKey: true }));
    assert.equal(undefined, sentMessage("openUrlInCurrentTab"));
  });

  should("consume modifier+digit when there's no result with that number", async () => {
    let prevented = false;
    await ui.onKeyEvent(jumpKey("5", { ctrlKey: true, preventDefault: () => prevented = true }));
    assert.isTrue(prevented);
    assert.equal(undefined, sentMessage("openUrlInCurrentTab"));
    assert.equal(3, ui.completionList.children.length);
  });

  should("do nothing while there are no results yet", async () => {
    results = [];
    await ui.update();
    await ui.onKeyEvent(jumpKey("1", { ctrlKey: true }));
    assert.equal(undefined, sentMessage("openUrlInCurrentTab"));
  });

  should("use event.code, so alt works on macOS, where alt+digit types a symbol", async () => {
    await Settings.set("vomnibarJumpModifier", "alt");
    await ui.onKeyEvent(jumpKey("1", { key: "¡", altKey: true }));
    ui.onHidden();
    assert.equal("http://1.com", sentMessage("openUrlInCurrentTab").url);
  });

  should("ignore digits on the numeric keypad", async () => {
    await ui.onKeyEvent(newKeyEvent({ type: "keydown", key: "1", code: "Numpad1", ctrlKey: true }));
    assert.equal(undefined, sentMessage("openUrlInCurrentTab"));
  });

  should("show no numbers and ignore modifier+digit when turned off", async () => {
    await Settings.set("vomnibarJumpModifier", "");
    await ui.update();
    assert.equal([], jumpKeyLabels());
    assert.isFalse(ui.completionList.classList.contains("jump-keys"));
    let prevented = false;
    await ui.onKeyEvent(jumpKey("1", { ctrlKey: true, preventDefault: () => prevented = true }));
    assert.isFalse(prevented);
    assert.equal(undefined, sentMessage("openUrlInCurrentTab"));
  });

  should("search the typed query when the primary custom search result is picked", async () => {
    userSearchEngines.set("e: https://example.com/?q=%s Example");
    ui.setQuery("e hello");
    ui.onInput();
    results = [
      {
        html: "",
        isCustomSearch: true,
        isPrimarySuggestion: true,
        searchUrl: "https://example.com/?q=%s",
      },
      {
        html: "",
        isCustomSearch: true,
        insertText: "hello world",
        url: "https://example.com/?q=hello+world",
      },
    ];
    await ui.update();
    await ui.onKeyEvent(jumpKey("1", { ctrlKey: true }));
    ui.onHidden();
    assert.equal("https://example.com/?q=hello", sentMessage("openUrlInCurrentTab").url);
  });

  should("open a custom search engine's completion", async () => {
    userSearchEngines.set("e: https://example.com/?q=%s Example");
    ui.setQuery("e hello");
    ui.onInput();
    results = [
      {
        html: "",
        isCustomSearch: true,
        isPrimarySuggestion: true,
        searchUrl: "https://example.com/?q=%s",
      },
      {
        html: "",
        isCustomSearch: true,
        insertText: "hello world",
        url: "https://example.com/?q=hello+world",
      },
    ];
    await ui.update();
    await ui.onKeyEvent(jumpKey("2", { ctrlKey: true }));
    ui.onHidden();
    assert.equal("https://example.com/?q=hello+world", sentMessage("openUrlInCurrentTab").url);
  });

  should("run the command with that number", async () => {
    vomnibarPage.reset();
    await vomnibarPage.activate({ completer: "commands", prefixCount: 3 });
    ui = vomnibarPage.ui;
    results = [
      { html: "", command: { registryEntry: { command: "scrollDown" } } },
      { html: "", command: { registryEntry: { command: "scrollUp" } } },
    ];
    await ui.update();
    assert.equal(["1", "2"], jumpKeyLabels());
    await ui.onKeyEvent(jumpKey("2", { ctrlKey: true }));
    await ui.onHidden();
    const message = sentMessage("runNormalModeCommand");
    assert.equal("scrollUp", message.command.command);
    assert.equal(3, message.count);
  });

  should("switch to the tab group with that number (ZG)", async () => {
    vomnibarPage.reset();
    await vomnibarPage.activate({ completer: "tabGroups" });
    ui = vomnibarPage.ui;
    results = [
      { html: "", tabId: 11, groupData: null },
      { html: "", tabId: 22, groupData: null },
    ];
    await ui.update();
    assert.equal(["1", "2"], jumpKeyLabels());
    await ui.onKeyEvent(jumpKey("2", { ctrlKey: true }));
    ui.onHidden();
    assert.equal(22, sentMessage("selectSpecificTab").id);
  });
});

context("vomnibar page, direct selection in zg", () => {
  let ui, sentMessages, results;

  const jumpKey = (digit) =>
    newKeyEvent({ type: "keydown", key: digit, code: `Digit${digit}`, ctrlKey: true });
  const jumpKeyLabels = () =>
    Array.from(ui.completionList.querySelectorAll(".jump-key")).map((el) => el.textContent);
  const sentMessage = (handler) => sentMessages.find((m) => m.handler == handler);

  setup(async () => {
    await testHelper.jsdomStub("pages/vomnibar_page.html");
    await Settings.onLoaded();
    sentMessages = [];
    stub(
      chrome.runtime,
      "sendMessage",
      withPromise((message) => {
        sentMessages.push(message);
        if (message.handler != "filterCompletions") return;
        if (message.completerName == "tabGroupColors") {
          return ["grey", "blue", "red"].map((color) => ({
            html: "",
            groupData: { action: "setColor", color },
          }));
        }
        return results;
      }),
    );
    results = [
      { html: "", groupData: { action: "addToGroup", groupId: 1 } },
      { html: "", groupData: { action: "addToGroup", groupId: 2 } },
    ];
    vomnibarPage.reset();
    await vomnibarPage.activate({ completer: "tabGroupAssign", selectFirst: true });
    ui = vomnibarPage.ui;
  });

  should("add the tabs to the group with that number", async () => {
    assert.equal(["1", "2"], jumpKeyLabels());
    await ui.onKeyEvent(jumpKey("2"));
    ui.onHidden();
    assert.equal(2, sentMessage("addTabsToGroup").groupId);
  });

  should("create a group with the Create entry, then pick its color by number", async () => {
    ui.setQuery("News");
    results = [
      { html: "", groupData: { action: "addToGroup", groupId: 1 } },
      { html: "", groupData: { action: "createGroup", name: "News" } },
    ];
    await ui.update();
    await ui.onKeyEvent(jumpKey("2"));
    assert.equal("tabGroupColors", ui.completerName);
    assert.equal(["1", "2", "3"], jumpKeyLabels());

    await ui.onKeyEvent(jumpKey("3"));
    ui.onHidden();
    assert.equal(
      { name: "News", color: "red" },
      Utils.pick(sentMessage("createTabGroup"), ["name", "color"]),
    );
  });

  should(
    "create the group with the name typed now, when Create was picked before it updated",
    async () => {
      // The results shown are for "Ne"; the user has since typed "News".
      ui.completions = [{ html: "", groupData: { action: "createGroup", name: "Ne" } }];
      ui.completionsQuery = "Ne";
      ui.setQuery("News");
      results = [{ html: "", groupData: { action: "createGroup", name: "News" } }];
      await ui.onKeyEvent(jumpKey("1"));
      assert.equal("tabGroupColors", ui.completerName);
      assert.equal("News", ui.pendingGroupName);
    },
  );

  should("not create a group when the name typed now matches an existing group", async () => {
    ui.completions = [{ html: "", groupData: { action: "createGroup", name: "Wor" } }];
    ui.completionsQuery = "Wor";
    ui.setQuery("Work");
    results = [{ html: "", groupData: { action: "addToGroup", groupId: 1 } }];
    await ui.onKeyEvent(jumpKey("1"));
    assert.equal("tabGroupAssign", ui.completerName);
    assert.equal(null, ui.pendingGroupName);
    assert.equal(undefined, sentMessage("addTabsToGroup"));
    assert.equal(1, ui.completionList.children.length);
  });

  should("not pick a color when the key which picked Create repeats", async () => {
    ui.setQuery("News");
    results = [{ html: "", groupData: { action: "createGroup", name: "News" } }];
    await ui.update();
    await ui.onKeyEvent(jumpKey("1"));
    assert.equal("tabGroupColors", ui.completerName);

    let prevented = false;
    await ui.onKeyEvent({ ...jumpKey("1"), repeat: true, preventDefault: () => prevented = true });
    assert.isTrue(prevented);
    ui.onHidden();
    assert.equal("tabGroupColors", ui.completerName);
    assert.equal(undefined, sentMessage("createTabGroup"));
  });

  should("not pick a color when Enter, which picked Create, repeats", async () => {
    ui.setQuery("News");
    results = [{ html: "", groupData: { action: "createGroup", name: "News" } }];
    await ui.update();
    await ui.onKeyEvent(newKeyEvent({ type: "keypress", key: "Enter" }));
    assert.equal("tabGroupColors", ui.completerName);

    await ui.onKeyEvent(newKeyEvent({ type: "keypress", key: "Enter", repeat: true }));
    ui.onHidden();
    assert.equal("tabGroupColors", ui.completerName);
    assert.equal(undefined, sentMessage("createTabGroup"));
  });

  should(
    "act on the result shown with that number, even if results for newer text are pending",
    async () => {
      // The user typed "News", but the results shown are still those for the empty query.
      ui.setQuery("News");
      await ui.onKeyEvent(jumpKey("1"));
      ui.onHidden();
      assert.equal(1, sentMessage("addTabsToGroup").groupId);
      assert.equal("tabGroupAssign", ui.completerName);
    },
  );
});

context("vomnibar page, Russian layout", () => {
  let ui;

  // A keydown as Chrome produces it with the Russian layout active.
  const ruKey = (key, code, modifiers) => newKeyEvent({ key, code, ...modifiers });

  setup(async () => {
    await testHelper.jsdomStub("pages/vomnibar_page.html");
    await Settings.onLoaded();
    stub(chrome.runtime, "sendMessage", withPromise(() => []));
    vomnibarPage.reset();
    await vomnibarPage.activate();
    ui = vomnibarPage.ui;
  });

  teardown(async () => {
    await Settings.clear();
  });

  should("read ctrl+j/k/n/p by their physical keys with ignoreKeyboardLayout", async () => {
    await Settings.set("ignoreKeyboardLayout", true);
    assert.equal("down", ui.actionFromKeyEvent(ruKey("о", "KeyJ", { ctrlKey: true })));
    assert.equal("up", ui.actionFromKeyEvent(ruKey("л", "KeyK", { ctrlKey: true })));
    assert.equal("down", ui.actionFromKeyEvent(ruKey("т", "KeyN", { ctrlKey: true })));
    assert.equal("up", ui.actionFromKeyEvent(ruKey("з", "KeyP", { ctrlKey: true })));
  });

  should("not read ctrl+j by its physical key without ignoreKeyboardLayout", async () => {
    await Settings.set("ignoreKeyboardLayout", false);
    assert.equal(null, ui.actionFromKeyEvent(ruKey("о", "KeyJ", { ctrlKey: true })));
  });

  should("leave Cyrillic text typed into the query alone", async () => {
    await Settings.set("ignoreKeyboardLayout", true);
    assert.equal(null, ui.actionFromKeyEvent(ruKey("о", "KeyJ")));
    assert.equal(null, ui.actionFromKeyEvent(ruKey("П", "KeyG", { shiftKey: true })));
  });
});
