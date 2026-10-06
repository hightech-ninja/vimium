let commandCount = null;
let commandName = null;

// Some tests have side effects on the handler stack and the active mode, so these are reset on
// setup. Also, some tests affect the focus (e.g. Vomnibar tests), so we make sure the window has
// the focus.
const initializeModeState = () => {
  globalThis.focus();
  Mode.reset();
  handlerStack.reset();
  const normalMode = installModes();
  normalMode.setPassKeys("p");
  normalMode.setKeyMapping({
    m: { options: {}, command: "m" }, // A mapped key.
    p: { options: {}, command: "p" }, // A pass key.
    z: { p: { options: {}, command: "zp" } }, // Not a pass key.
  });
  normalMode.setCommandHandler(({ command, count }) => {
    [commandName, commandCount] = [command.command, count];
  });
  commandName = null;
  commandCount = null;
  return normalMode;
};

//
// Retrieve the hint markers as an array object.
//
const getHintMarkerEls = () => Array.from(document.querySelectorAll(".vimiumHintMarker"));

const stubSettings = (key, value) => stub(Settings._settings, key, value);

HintCoordinator.sendMessage = (name, request) => {
  if (request == null) {
    request = {};
  }
  if (HintCoordinator[name]) {
    HintCoordinator[name](request);
  }
  return request;
};

const activateLinkHintsMode = (mode = OPEN_IN_CURRENT_TAB) => {
  const modeIndex = availableModes.indexOf(mode);
  HintCoordinator.getHintDescriptors({ modeIndex }, {}, () => {});
  HintCoordinator.activateMode({
    frameIdToHintDescriptors: {},
    modeIndex,
    originatingFrameId: frameId,
  });
  return HintCoordinator.linkHintsMode;
};

//
// Generate tests that are common to both default and filtered
// link hinting modes.
//
const createGeneralHintTests = (isFilteredMode) => {
  globalThis.vimiumOnClickAttributeName = "does-not-matter";

  context("Link hints", () => {
    setup(() => {
      initializeModeState();
      const testContent = "<a>test</a><a>tress</a>";
      document.getElementById("test-div").innerHTML = testContent;
      stubSettings("filterLinkHints", isFilteredMode);
      stubSettings("linkHintCharacters", "ab");
      stubSettings("linkHintNumbers", "12");
      stub(globalThis, "windowIsFocused", () => true);
    });

    teardown(() => document.getElementById("test-div").innerHTML = "");

    should("create hints when activated, discard them when deactivated", () => {
      const mode = activateLinkHintsMode();
      assert.isFalse(mode.containerEl == null);
      mode.deactivateMode();
      assert.isTrue(mode.containerEl == null);
    });

    should("position items correctly", () => {
      const assertStartPosition = (element1, element2) => {
        assert.equal(element1.getClientRects()[0].left, element2.getClientRects()[0].left);
        assert.equal(element1.getClientRects()[0].top, element2.getClientRects()[0].top);
      };
      stub(document.body.style, "position", "static");
      let mode = activateLinkHintsMode();
      let markerEls = getHintMarkerEls();
      assertStartPosition(document.getElementsByTagName("a")[0], markerEls[0]);
      assertStartPosition(document.getElementsByTagName("a")[1], markerEls[1]);
      mode.deactivateMode();
      stub(document.body.style, "position", "relative");
      mode = activateLinkHintsMode();
      markerEls = getHintMarkerEls();
      assertStartPosition(document.getElementsByTagName("a")[0], markerEls[0]);
      assertStartPosition(document.getElementsByTagName("a")[1], markerEls[1]);
      mode.deactivateMode();
    });
  });
};

createGeneralHintTests(false);
createGeneralHintTests(true);

context("False positives in link-hint", () => {
  setup(() => {
    const testContent = '<span class="buttonWrapper">false positive<a>clickable</a></span>' +
      '<span class="buttonWrapper">clickable</span>';
    document.getElementById("test-div").innerHTML = testContent;
    stubSettings("filterLinkHints", true);
    stubSettings("linkHintNumbers", "12");
    stub(globalThis, "windowIsFocused", () => true);
  });

  teardown(() => document.getElementById("test-div").innerHTML = "");

  should("handle false positives", () => {
    const mode = activateLinkHintsMode();
    mode.deactivateMode();
    assert.equal(["clickable", "clickable"], mode.hintMarkers.map((m) => m.linkText));
  });
});

context("jsaction matching", () => {
  let element;

  setup(() => {
    stubSettings("filterLinkHints", true);
    const testContent = '<p id="test-paragraph">clickable</p>';
    document.getElementById("test-div").innerHTML = testContent;
    element = document.getElementById("test-paragraph");
  });

  teardown(() => document.getElementById("test-div").innerHTML = "");

  should("select jsaction elements", () => {
    for (const text of ["click:namespace.actionName", "namespace.actionName"]) {
      element.setAttribute("jsaction", text);
      const mode = activateLinkHintsMode();
      mode.deactivateMode();
      assert.equal(1, mode.hintMarkers.length);
      assert.equal("clickable", mode.hintMarkers[0].linkText);
      assert.equal(element, mode.hintMarkers[0].localHint.element);
    }
  });

  should("not select inactive jsaction elements", () => {
    const attributes = [
      "mousedown:namespace.actionName",
      "click:namespace._",
      "none",
      "namespace:_",
    ];
    for (const attribute of attributes) {
      element.setAttribute("jsaction", attribute);
      const linkHints = activateLinkHintsMode();
      const hintMarkers = getHintMarkerEls().filter((marker) => marker.linkText !== "Frame.");
      linkHints.deactivateMode();
      assert.equal(0, hintMarkers.length);
    }
  });
});

context("link hints for image maps", () => {
  setup(() => {
    const testContent = '<img usemap="#the-map" style="width: 50px; height: 50px">' +
      '<map name="the-map">' +
      '<area shape="rect" coords="0,0,20,50" href="#">' +
      '<area shape="rect" coords="0,30,30,50" href="#">' +
      "</area>";
    document.getElementById("test-div").innerHTML = testContent;
  });

  teardown(() => document.getElementById("test-div").innerHTML = "");

  should("generate a hint for each area in the image map", () => {
    const mode = activateLinkHintsMode();
    const markerEls = getHintMarkerEls();
    assert.equal(2, markerEls.length);
    mode.deactivateMode();
  });
});

const sendKeyboardEvent = (key, type, extra) => {
  if (type == null) type = "keydown";
  if (extra == null) extra = {};
  return handlerStack.bubbleEvent(
    type,
    Object.assign(extra, {
      type,
      key,
      preventDefault() {},
      stopImmediatePropagation() {},
    }),
  );
};

const sendKeyboardEvents = (keys) => {
  for (const key of keys.split("")) {
    sendKeyboardEvent(key);
  }
};

// TODO(philc): For some reason, this test corrupts the state linkhints state for other tests, in particular,
// the alphabet hints tests. I haven't yet dug into why.
// const inputs = [];
// context("Test link hints for focusing input elements correctly", () => {
//   let linkHintsMode;

//   setup(() => {
//     let input;
//     initializeModeState();
//     const testDiv = document.getElementById("test-div");
//     testDiv.innerHTML = "";

//     stubSettings("filterLinkHints", false);
//     stubSettings("linkHintCharacters", "ab");

//     // Every HTML5 input type except for hidden. We should be able to activate all of them with link hints.
//     // NOTE(philc): I'm not sure why, but "image" doesn't get a link hint in Puppeteer, so I've omitted it.
//     const inputTypes = ["button", "checkbox", "color", "date", "datetime", "datetime-local", "email", "file",
//       "month", "number", "password", "radio", "range", "reset", "search", "submit", "tel", "text",
//       "time", "url", "week"];

//     for (let type of inputTypes) {
//       input = document.createElement("input");
//       input.type = type;
//       testDiv.appendChild(input);
//       inputs.push(input);
//     }

//     // Manually add also a select element to test focus.
//     input = document.createElement("select");
//     testDiv.appendChild(input);
//     inputs.push(input);
//   });

//   teardown(() => {
//     document.getElementById("test-div").innerHTML = "";
//     // linkHintsMode.deactivateMode(); // TODO(philc): I don't think this should be necessary.
//   });

//   should("Focus each input when its hint text is typed", () => {
//     for (var input of inputs) {
//       input.scrollIntoView(); // Ensure the element is visible so we create a link hint for it.

//       const activeListener = ensureCalled(function(event) {
//         if (event.type === "focus") { return input.blur(); }
//       });
//       input.addEventListener("focus", activeListener, false);
//       input.addEventListener("click", activeListener, false);

//       linkHintsMode = activateLinkHintsMode();
//       const [hint] = getHintMarkerEls().
//             filter(hint => input === HintCoordinator.getLocalHint(hint.hintDescriptor).element);

//       for (let char of hint.hintString)
//         sendKeyboardEvent(char);
//       linkHintsMode.deactivateMode();

//       input.removeEventListener("focus", activeListener, false);
//       input.removeEventListener("click", activeListener, false);
//     }
//   });
// });

context("Test link hints for changing mode", () => {
  let linkHints;

  setup(() => {
    initializeModeState();
    const testDiv = document.getElementById("test-div");
    testDiv.innerHTML = "<a>link</a>";
    linkHints = activateLinkHintsMode();
  });

  teardown(() => {
    document.getElementById("test-div").innerHTML = "";
    linkHints.deactivateMode();
  });

  should("change mode on shift", () => {
    assert.equal("open-in-current-tab", linkHints.mode.name);
    sendKeyboardEvent("Shift", "keydown");
    assert.equal("open-in-new-background-tab", linkHints.mode.name);
    sendKeyboardEvent("Shift", "keyup");
    assert.equal("open-in-current-tab", linkHints.mode.name);
  });

  should("change mode on ctrl", () => {
    assert.equal("open-in-current-tab", linkHints.mode.name);
    sendKeyboardEvent("Control", "keydown");
    assert.equal("open-in-new-foreground-tab", linkHints.mode.name);
    sendKeyboardEvent("Control", "keyup");
    assert.equal("open-in-current-tab", linkHints.mode.name);
  });
});

const createLinks = function (n) {
  for (let i = 0, end = n; i < end; i++) {
    const link = document.createElement("a");
    link.textContent = "test";
    document.getElementById("test-div").appendChild(link);
  }
};

context("Alphabet link hints", () => {
  let mode;
  setup(() => {
    initializeModeState();
    stubSettings("filterLinkHints", false);
    stubSettings("linkHintCharacters", "ab");
    stub(globalThis, "windowIsFocused", () => true);

    document.getElementById("test-div").innerHTML = "";
    // Three hints will trigger double hint chars.
    createLinks(3);
    mode = activateLinkHintsMode();
  });

  teardown(() => {
    mode.deactivateMode();
    document.getElementById("test-div").innerHTML = "";
  });

  should("label the hints correctly", () => {
    assert.equal(
      ["aa", "b", "ab"],
      mode.hintMarkers.map((m) => m.hintString),
    );
  });

  should("narrow the hints", () => {
    sendKeyboardEvent("a");
    assert.equal(
      ["", "none", ""],
      mode.hintMarkers.map((m) => m.element.style.display),
    );
  });

  should("narrow the hints by physical key with a Russian layout and ignoreKeyboardLayout", () => {
    stubSettings("ignoreKeyboardLayout", true);
    sendKeyboardEvent("ф", "keydown", { code: "KeyA" });
    assert.equal(
      ["", "none", ""],
      mode.hintMarkers.map((m) => m.element.style.display),
    );
  });

  should("generate the correct number of alphabet hints", () => {
    const alphabetHints = new AlphabetHints();
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const hintStrings = alphabetHints.hintStrings(n);
      assert.equal(n, hintStrings.length);
    }
  });

  should("generate non-overlapping alphabet hints", () => {
    const alphabetHints = new AlphabetHints();
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const hintStrings = alphabetHints.hintStrings(n);
      for (const h1 of hintStrings) {
        for (const h2 of hintStrings) {
          if (h1 !== h2) {
            assert.isFalse(0 === h1.indexOf(h2));
          }
        }
      }
    }
  });
});

context("Overlapping link hint markers", () => {
  let mode;
  const displays = () => mode.hintMarkers.map((m) => m.element.style.display);
  const markerFor = (id) => mode.hintMarkers.find((m) => m.localHint.element.id === id);

  setup(() => {
    initializeModeState();
    stubSettings("filterLinkHints", false);
    stubSettings("linkHintCharacters", "ab");
    stubSettings("suppressOverlappingHintMarkers", true);
    stub(globalThis, "windowIsFocused", () => true);
    // A link around a button, whose hints are in the same place, and a link elsewhere.
    document.getElementById("test-div").innerHTML = `
      <a id="first" href="#" style="position: absolute; left: 200px; top: 200px;"
        ><button id="second">second</button></a>
      <a id="other" href="#" style="position: absolute; left: 200px; top: 300px;">other</a>`;
  });

  teardown(() => {
    mode?.deactivateMode();
    document.getElementById("test-div").innerHTML = "";
    // Activating a link leaves a flash over it for a while, which would hide later tests' links.
    for (const el of document.querySelectorAll(".vimium-flash")) el.remove();
  });

  should("show one marker of the markers which cover each other", () => {
    mode = activateLinkHintsMode();
    assert.equal(3, mode.hintMarkers.length);
    assert.equal("", markerFor("first").element.style.display);
    assert.equal("none", markerFor("second").element.style.display);
    assert.equal("", markerFor("other").element.style.display);
  });

  should("show the next covered marker on space, and cycle back", () => {
    mode = activateLinkHintsMode();
    sendKeyboardEvent(" ");
    assert.equal("none", markerFor("first").element.style.display);
    assert.equal("", markerFor("second").element.style.display);
    assert.equal("", markerFor("other").element.style.display);
    sendKeyboardEvent(" ");
    assert.equal("", markerFor("first").element.style.display);
    assert.equal("none", markerFor("second").element.style.display);
  });

  should("keep the marker shown by space when the hints are updated", () => {
    mode = activateLinkHintsMode();
    sendKeyboardEvent(" ");
    // Tab updates the visible markers without changing which hints match.
    sendKeyboardEvent("Tab");
    assert.equal("none", markerFor("first").element.style.display);
    assert.equal("", markerFor("second").element.style.display);
  });

  should("activate a hidden marker's link by typing its hint", () => {
    let clicked = false;
    document.getElementById("second").addEventListener("click", () => clicked = true);
    mode = activateLinkHintsMode();
    const hidden = markerFor("second");
    assert.equal("none", hidden.element.style.display);
    sendKeyboardEvents(hidden.hintString);
    assert.isTrue(clicked);
  });

  should("show every marker when the setting is off", () => {
    stubSettings("suppressOverlappingHintMarkers", false);
    mode = activateLinkHintsMode();
    assert.equal(["", "", ""], displays());
  });

  should("not hide markers which only touch, nor chain them into one group", () => {
    // Rows closer together than a marker's height, so each marker overlaps the next a little.
    document.getElementById("test-div").innerHTML = [0, 1, 2, 3, 4].map((i) =>
      `<a style="position: absolute; left: 200px; top: ${200 + i * 10}px;">row ${i}</a>`
    ).join("");
    mode = activateLinkHintsMode();
    assert.equal(5, mode.hintMarkers.length);
    const rects = mode.hintMarkers.map((m) => m.element.getClientRects()[0]);
    assert.isTrue(Rect.intersects(rects[0], rects[1]));
    assert.equal(["", "", "", "", ""], displays());
  });

  context("with filtered hints", () => {
    const isShown = (id) => markerFor(id).element.style.display !== "none";
    const activeId = () => mode.markerMatcher.activeHintMarker.localHint.element.id;

    setup(() => {
      stubSettings("filterLinkHints", true);
      stubSettings("linkHintNumbers", "0123456789");
      // The button's text is shorter, so it scores higher when its text is typed.
      document.getElementById("test-div").innerHTML = `
        <a id="first" href="#" style="position: absolute; left: 200px; top: 200px;"
          ><button id="second">alpha</button> beta gamma</a>
        <a id="other" href="#" style="position: absolute; left: 200px; top: 300px;">other</a>`;
      mode = activateLinkHintsMode();
    });

    should("show the active hint when it's covered by another", () => {
      sendKeyboardEvents("alpha");
      assert.equal("second", activeId());
      assert.isTrue(isShown("second"));
      assert.isFalse(isShown("first"));
    });

    should("show the hint which Tab makes active", () => {
      // Tab through all three hints, so the active hint is each of the covered pair once.
      for (let i = 0; i < 3; i++) {
        sendKeyboardEvent("Tab");
        assert.isTrue(isShown(activeId()));
      }
    });

    should("not hide the active hint on shift+space", () => {
      while (activeId() === "other") sendKeyboardEvent("Tab");
      const active = activeId();
      sendKeyboardEvent(" ", "keydown", { shiftKey: true });
      assert.isTrue(isShown(active));
    });
  });
});

context("Selecting the scroll target with link hints", () => {
  let mode;
  const pane = (id, left, content) =>
    `<div id="${id}" style="position: absolute; left: ${left}px; top: 200px; width: 150px;
      height: 100px; overflow: auto;">${content}<div style="height: 1000px;"></div></div>`;
  const selectByHint = (id) => {
    mode = activateLinkHintsMode(SELECT_SCROLL_TARGET);
    const marker = mode.hintMarkers.find((m) => m.localHint.element.id === id);
    sendKeyboardEvents(marker.hintString);
  };
  const $ = (id) => document.getElementById(id);

  setup(() => {
    initializeModeState();
    stubSettings("filterLinkHints", false);
    stubSettings("linkHintCharacters", "ab");
    stubSettings("smoothScroll", false);
    stub(globalThis, "windowIsFocused", () => true);
    $("test-div").innerHTML = pane("pane1", 200, `<a id="link1" href="#">one</a>`) +
      pane(
        "pane2",
        400,
        `<a id="link2" href="#">two</a> <input id="input2">
         <details id="details2"><summary>more</summary>text</details>`,
      ) +
      `<a id="outside" href="#" style="position: absolute; left: 200px; top: 350px;">out</a>`;
  });

  teardown(() => {
    mode?.deactivateMode();
    $("test-div").innerHTML = "";
    for (const el of document.querySelectorAll(".vimium-flash")) el.remove();
  });

  should("select the pane which contains the chosen element", () => {
    selectByHint("link2");
    assert.isTrue($("pane2") === Scroller.activeElement());
    assert.isTrue($("pane2") === Scroller.activeScrollContainer());
  });

  should("make scrolling commands scroll the selected pane", () => {
    selectByHint("link2");
    Scroller.scrollBy("y", 30);
    assert.equal(30, $("pane2").scrollTop);
    assert.equal(0, $("pane1").scrollTop);
    Scroller.scrollTo("y", "max");
    assert.equal($("pane2").scrollHeight - $("pane2").clientHeight, $("pane2").scrollTop);
  });

  should("not click, focus or toggle the chosen element", () => {
    let clicked = false;
    $("link2").addEventListener("click", () => clicked = true);
    selectByHint("link2");
    assert.isFalse(clicked);
    selectByHint("input2");
    assert.isFalse(document.activeElement === $("input2"));
    assert.isTrue($("pane2") === Scroller.activeElement());
    selectByHint("details2");
    assert.isFalse($("details2").open);
  });

  should("select the element itself when no ancestor scrolls", () => {
    selectByHint("outside");
    assert.isTrue($("outside") === Scroller.activeElement());
    assert.equal(null, Scroller.activeScrollContainer());
  });

  should("have no active element after it's removed from the page", () => {
    selectByHint("link2");
    $("pane2").remove();
    assert.equal(null, Scroller.activeElement());
  });

  should("focus the frame of the chosen element, which handles scrolling commands", () => {
    let focusedFrame = false;
    stub(globalThis, "focusThisFrame", () => focusedFrame = true);
    // Run nextTick callbacks now. Waiting for them would also run other tests' pending callbacks.
    stub(Utils, "nextTick", (fn) => fn());
    selectByHint("link2");
    assert.isFalse(focusedFrame);
    stub(globalThis, "windowIsFocused", () => false);
    selectByHint("link1");
    assert.isTrue(focusedFrame);
    assert.isTrue($("pane1") === Scroller.activeElement());
  });

  should("choose a new scroll target when the selected one was removed", () => {
    Scroller.selectElement($("pane2"));
    $("pane2").remove();
    Scroller.scrollBy("y", 30);
    assert.isTrue(Scroller.activeElement() != null);
  });

  should("prefer the pane which scrolls vertically to a horizontal scroller inside it", () => {
    $("pane2").insertAdjacentHTML(
      "afterbegin",
      `<pre style="width: 100px; overflow-x: auto;"><a id="code-link" href="#">${
        "x".repeat(200)
      }</a></pre>`,
    );
    Scroller.selectElement($("code-link"));
    assert.isTrue($("pane2") === Scroller.activeElement());
  });

  should("treat a site's special scrolling element as a pane", () => {
    specialScrollingElementMap[location.host] = "#pane2";
    try {
      Scroller.selectElement($("link2"));
      assert.isTrue($("pane2") === Scroller.activeScrollContainer());
    } finally {
      delete specialScrollingElementMap[location.host];
    }
  });
});

context("Local marks in scrolling panes", () => {
  const registryEntry = { options: {} };
  const $ = (id) => document.getElementById(id);
  const pane = (id, left) =>
    `<div id="${id}" style="position: absolute; left: ${left}px; top: 200px; width: 150px;
      height: 100px; overflow: auto;"><a href="#">link</a><div style="height: 1000px;"></div>
    </div>`;
  const setMark = (key) => {
    Marks.activateCreateMode(1, { registryEntry });
    sendKeyboardEvent(key);
  };
  const gotoMark = (key) => {
    Marks.activateGotoMode(1, { registryEntry });
    sendKeyboardEvent(key);
  };
  const markKeys = () => Object.keys(localStorage).filter((k) => k.startsWith("vimiumMark|"));

  setup(() => {
    initializeModeState();
    stubSettings("smoothScroll", false);
    Marks.localRegisters = {};
    $("test-div").innerHTML = pane("pane1", 200) + pane("pane2", 400) +
      `<a id="outside" href="#" style="position: absolute; left: 200px; top: 350px;">out</a>`;
  });

  teardown(() => {
    $("test-div").innerHTML = "";
    for (const key of markKeys()) localStorage.removeItem(key);
    Marks.localRegisters = {};
  });

  should("restore the position of the pane the mark was set in", () => {
    Scroller.selectElement($("pane2"));
    $("pane2").scrollTop = 120;
    setMark("a");
    $("pane2").scrollTop = 0;
    Scroller.selectElement($("pane1"));
    $("pane1").scrollTop = 50;
    gotoMark("a");
    assert.equal(120, $("pane2").scrollTop);
    assert.equal(50, $("pane1").scrollTop);
    assert.isTrue($("pane2") === Scroller.activeElement());
  });

  should("jump back to the previous pane and position with `", () => {
    Scroller.selectElement($("pane2"));
    $("pane2").scrollTop = 120;
    setMark("a");
    Scroller.selectElement($("pane1"));
    $("pane1").scrollTop = 50;
    gotoMark("a");
    $("pane1").scrollTop = 0;
    gotoMark("`");
    assert.equal(50, $("pane1").scrollTop);
    assert.isTrue($("pane1") === Scroller.activeElement());
  });

  should("find a pane without an id again after the page re-renders it", () => {
    $("pane2").removeAttribute("id");
    const original = $("test-div").children[1];
    Scroller.selectElement(original);
    original.scrollTop = 80;
    setMark("a");
    $("test-div").innerHTML = $("test-div").innerHTML;
    const rerendered = $("test-div").children[1];
    assert.isFalse(rerendered === original);
    gotoMark("a");
    assert.equal(80, rerendered.scrollTop);
  });

  should("fall back to the document position when the pane is gone", () => {
    Scroller.selectElement($("pane2"));
    $("pane2").scrollTop = 120;
    setMark("a");
    $("pane2").remove();
    gotoMark("a");
    assert.equal(null, Scroller.activeElement());
  });

  should("not record a pane when scrolling commands scroll the document", () => {
    Scroller.selectElement($("outside"));
    const mark = JSON.parse(Marks.getMarkString());
    assert.equal(undefined, mark.container);
  });

  should("restore marks set before panes were recorded", () => {
    Scroller.selectElement($("pane1"));
    localStorage[Marks.getLocationKey("a")] = JSON.stringify({ scrollX: 0, scrollY: 0, hash: "" });
    gotoMark("a");
    assert.equal(0, globalThis.scrollY);
    assert.isTrue($("pane1") === Scroller.activeElement());
  });
});

context("Filtered link hints", () => {
  // In all of these tests, the order of the elements returned by getHintMarkerEls() may be
  // different from the order they are listed in the test HTML content. This is because
  // LinkHints.activateMode() sorts the elements.

  let mode;

  setup(() => {
    stubSettings("filterLinkHints", true);
    stubSettings("linkHintNumbers", "0123456789");
    stub(globalThis, "windowIsFocused", () => true);
  });

  context("Text hints", () => {
    setup(() => {
      initializeModeState();
      const testContent = "<a>test</a><a>tress</a><a>trait</a><a>track<img alt='alt text'/></a>";
      document.getElementById("test-div").innerHTML = testContent;
      mode = activateLinkHintsMode();
    });

    teardown(() => {
      document.getElementById("test-div").innerHTML = "";
      mode.deactivateMode();
    });

    should("label the hints", () => {
      const hintMarkers = getHintMarkerEls();
      const expectedMarkers = [1, 2, 3, 4].map((m) => m.toString());
      const actualMarkers = [0, 1, 2, 3].map((i) => hintMarkers[i].textContent.toLowerCase());
      assert.equal(expectedMarkers.length, actualMarkers.length);
      for (const marker of expectedMarkers) {
        assert.isTrue(actualMarkers.includes(marker));
      }
    });

    should("narrow the hints", () => {
      sendKeyboardEvent("t");
      sendKeyboardEvent("r");
      assert.equal(
        ["none", "", "", ""],
        mode.hintMarkers.map((m) => m.element.style.display),
      );
      assert.equal("3", mode.hintMarkers[1].hintString);
      sendKeyboardEvent("a");
      assert.equal("1", mode.hintMarkers[3].hintString);
    });

    // This test is the same as above, but with an extra non-matching character. The effect should
    // be the same.
    should("narrow the hints and ignore typing mistakes", () => {
      sendKeyboardEvent("t");
      sendKeyboardEvent("r");
      sendKeyboardEvent("x");
      assert.equal(
        ["none", "", "", ""],
        mode.hintMarkers.map((m) => m.element.style.display),
      );
      assert.equal("3", mode.hintMarkers[1].hintString);
      sendKeyboardEvent("a");
      assert.equal("1", mode.hintMarkers[3].hintString);
    });
  });

  context("Image hints", () => {
    setup(() => {
      initializeModeState();
      const testContent = "<a><img alt='alt text' width='10px' height='10px'/></a>" +
        "<a><img alt='alt text' title='some title' width='10px' height='10px'/></a>" +
        "<a><img title='some title' width='10px' height='10px'/></a>" +
        "<a><img src='' width='320px' height='100px'/></a>";
      document.getElementById("test-div").innerHTML = testContent;
      mode = activateLinkHintsMode();
    });

    teardown(() => {
      document.getElementById("test-div").innerHTML = "";
      mode.deactivateMode();
    });

    should("label the images", () => {
      let hintMarkers = getHintMarkerEls().map((m) => m.textContent.toLowerCase());
      // We don't know the actual hint numbers which will be assigned, so we replace them with "N".
      hintMarkers = hintMarkers.map((str) => str.replace(/^[1-4]/, "N"));
      assert.equal(4, hintMarkers.length);
      assert.isTrue(hintMarkers.includes("N: alt text"));
      assert.isTrue(hintMarkers.includes("N: some title"));
      assert.isTrue(hintMarkers.includes("N: alt text"));
      assert.isTrue(hintMarkers.includes("N"));
    });
  });

  context("Input hints", () => {
    setup(() => {
      initializeModeState();
      const testContent =
        `<input type='text' value='some value'/><input type='password' value='some value'/> \
<textarea>some text</textarea><label for='test-input'/>a label</label> \
<input type='text' id='test-input' value='some value'/> \
<label for='test-input-2'/>a label: </label><input type='text' id='test-input-2' value='some value'/>`;
      document.getElementById("test-div").innerHTML = testContent;
      mode = activateLinkHintsMode();
    });

    teardown(() => {
      document.getElementById("test-div").innerHTML = "";
      mode.deactivateMode();
    });

    should("label the input elements", () => {
      let hintMarkers = getHintMarkerEls();
      hintMarkers = getHintMarkerEls().map((m) => m.textContent.toLowerCase());
      // We don't know the actual hint numbers which will be assigned, so we replace them with "N".
      hintMarkers = hintMarkers.map((str) => str.replace(/^[0-9]+/, "N"));
      assert.equal(5, hintMarkers.length);
      assert.isTrue(hintMarkers.includes("N"));
      assert.isTrue(hintMarkers.includes("N"));
      assert.isTrue(hintMarkers.includes("N: a label"));
      assert.isTrue(hintMarkers.includes("N: a label"));
      assert.isTrue(hintMarkers.includes("N"));
    });
  });

  context("Text hint scoring", () => {
    let getActiveHintMarker;

    setup(() => {
      initializeModeState();
      const testContent = [
        { id: 0, text: "the xboy stood on the xburning deck" }, // Noise.
        { id: 1, text: "the boy stood on the xburning deck" }, // Whole word (boy).
        { id: 2, text: "on the xboy stood the xburning deck" }, // Start of text (on).
        { id: 3, text: "the xboy stood on the xburning deck" }, // Noise.
        { id: 4, text: "the xboy stood on the xburning deck" }, // Noise.
        { id: 5, text: "the xboy stood on the xburning" }, // Shortest text..
        { id: 6, text: "the xboy stood on the burning xdeck" }, // Start of word (bu)
        { id: 7, text: "test abc one - longer" }, // For tab test - 2.
        { id: 8, text: "test abc one" }, // For tab test - 1.
        { id: 9, text: "test abc one - longer still" }, // For tab test - 3.
      ].map(({ id, text }) => `<a id=\"${id}\">${text}</a>`).join(" ");
      document.getElementById("test-div").innerHTML = testContent;
      mode = activateLinkHintsMode();

      getActiveHintMarker = () => {
        return HintCoordinator.getLocalHint(
          mode.markerMatcher.activeHintMarker.hintDescriptor,
        ).element.id;
      };
    });

    teardown(() => {
      document.getElementById("test-div").innerHTML = "";
      mode.deactivateMode();
    });

    should("score start-of-word matches highly", () => {
      sendKeyboardEvents("bu");
      assert.equal("6", getActiveHintMarker());
    });

    should("score start-of-text matches highly (br)", () => {
      sendKeyboardEvents("on");
      assert.equal("2", getActiveHintMarker());
    });

    should("score whole-word matches highly", () => {
      sendKeyboardEvents("boy");
      assert.equal("1", getActiveHintMarker());
    });

    should("score shorter texts more highly", () => {
      sendKeyboardEvents("stood");
      assert.equal("5", getActiveHintMarker());
    });

    should("use tab to select the active hint", () => {
      sendKeyboardEvents("abc");
      assert.equal("8", getActiveHintMarker());
      sendKeyboardEvent("Tab", "keydown");
      assert.equal("7", getActiveHintMarker());
      sendKeyboardEvent("Tab", "keydown");
      assert.equal("9", getActiveHintMarker());
    });
  });
});

context("Input focus", () => {
  setup(() => {
    initializeModeState();
    const testContent = `<input type='text' id='first'/><input style='display:none;' id='second'/> \
<input type='password' id='third' value='some value'/>`;
    document.getElementById("test-div").innerHTML = testContent;
  });

  teardown(() => document.getElementById("test-div").innerHTML = ""),
    should("focus the first element", () => {
      NormalModeCommands.focusInput(1);
      assert.equal("first", document.activeElement.id);
    });

  should("focus the nth element", () => {
    NormalModeCommands.focusInput(100);
    assert.equal("third", document.activeElement.id);
  });

  should("activate insert mode on the first element", () => {
    NormalModeCommands.focusInput(1);
    assert.isTrue(InsertMode.permanentInstance.isActive());
  });

  should("activate insert mode on the first element", () => {
    NormalModeCommands.focusInput(100);
    assert.isTrue(InsertMode.permanentInstance.isActive());
  });

  should("activate the most recently-selected input if the count is 1", () => {
    NormalModeCommands.focusInput(3);
    NormalModeCommands.focusInput(1);
    assert.equal("third", document.activeElement.id);
  });

  should("not trigger insert if there are no inputs", () => {
    document.getElementById("test-div").innerHTML = "";
    NormalModeCommands.focusInput(1);
    assert.isFalse(InsertMode.permanentInstance.isActive());
  });
});

// TODO: these find prev/next link tests could be refactored into unit tests which invoke a function
// which has a tighter contract than goNext(), since they test minor aspects of goNext()'s link
// matching behavior, and we don't need to construct external state many times over just to test
// that. i.e. these tests should look something like:
// assert.equal(findLink(html("<a href=...">))[0].href, "first")
// These could then move outside of the dom_tests file.
context("Find prev / next links", () => {
  setup(() => {
    initializeModeState();
    globalThis.location.hash = "";
  });

  should("find exact matches", () => {
    document.getElementById("test-div").innerHTML = `\
<a href='#first'>nextcorrupted</a>
<a href='#second'>next page</a>\
`;
    stubSettings("nextPatterns", "next");
    NormalModeCommands.goNext();
    assert.equal("#second", globalThis.location.hash);
  });

  should("match against non-word patterns", () => {
    document.getElementById("test-div").innerHTML = `\
<a href='#first'>&gt;&gt;</a>\
`;
    stubSettings("nextPatterns", ">>");
    NormalModeCommands.goNext();
    assert.equal("#first", globalThis.location.hash);
  });

  should("favor matches with fewer words", () => {
    document.getElementById("test-div").innerHTML = `\
<a href='#first'>lorem ipsum next</a>
<a href='#second'>next!</a>\
`;
    stubSettings("nextPatterns", "next");
    NormalModeCommands.goNext();
    assert.equal("#second", globalThis.location.hash);
  });

  should("find link relation in header", () => {
    document.getElementById("test-div").innerHTML = `\
<link rel='next' href='#first'>\
`;
    NormalModeCommands.goNext();
    assert.equal("#first", globalThis.location.hash);
  });

  should("favor link relation to text matching", () => {
    document.getElementById("test-div").innerHTML = `\
<link rel='next' href='#first'>
<a href='#second'>next</a>\
`;
    NormalModeCommands.goNext();
    assert.equal("#first", globalThis.location.hash);
  });

  should("match mixed case link relation", () => {
    document.getElementById("test-div").innerHTML = `\
<link rel='Next' href='#first'>\
`;
    NormalModeCommands.goNext();
    assert.equal("#first", globalThis.location.hash);
  });

  should("match against the title attribute", () => {
    document.getElementById("test-div").innerHTML = `\
<a title='Next page' href='#first'>unhelpful text</a>\
`;
    NormalModeCommands.goNext();
    assert.equal("#first", globalThis.location.hash);
  });

  should("match against the aria-label attribute", () => {
    document.getElementById("test-div").innerHTML = `\
<a aria-label='Next page' href='#first'>unhelpful text</a>\
`;
    NormalModeCommands.goNext();
    assert.equal("#first", globalThis.location.hash);
  });
});

context("Key mapping", () => {
  let normalMode, handlerCalled, handlerCalledCount;

  setup(() => {
    normalMode = initializeModeState();
    handlerCalled = false;
    handlerCalledCount = 0;
    normalMode.setCommandHandler(({ count }) => {
      handlerCalled = true;
      handlerCalledCount = count;
    });
  });

  should("recognize first mapped key", () => {
    assert.isTrue(normalMode.isMappedKey("m"));
  });

  should("recognize second mapped key", () => {
    assert.isFalse(normalMode.isMappedKey("p"));
    sendKeyboardEvent("z");
    assert.isTrue(normalMode.isMappedKey("p"));
  });

  should("recognize pass keys", () => {
    assert.isTrue(normalMode.isPassKey("p"));
  });

  should("not mis-recognize pass keys", () => {
    assert.isFalse(normalMode.isMappedKey("p"));
    sendKeyboardEvent("z");
    assert.isTrue(normalMode.isMappedKey("p"));
  });

  should("recognize initial count keys", () => {
    assert.isTrue(normalMode.isCountKey("1"));
    assert.isTrue(normalMode.isCountKey("9"));
  });

  should("not recognize '0' as initial count key", () => {
    assert.isFalse(normalMode.isCountKey("0"));
  });

  should("recognize subsequent count keys", () => {
    sendKeyboardEvent("1");
    assert.isTrue(normalMode.isCountKey("0"));
    assert.isTrue(normalMode.isCountKey("9"));
  });

  should("set and call command handler", () => {
    sendKeyboardEvent("m");
    assert.isTrue(handlerCalled);
  });

  should("not call command handler for pass keys", () => {
    sendKeyboardEvent("p");
    assert.isFalse(handlerCalled);
  });

  should("accept a count prefix with a single digit", () => {
    sendKeyboardEvent("2");
    sendKeyboardEvent("m");
    assert.equal(2, handlerCalledCount);
  });

  should("accept a count prefix with multiple digits", () => {
    sendKeyboardEvent("2");
    sendKeyboardEvent("0");
    sendKeyboardEvent("m");
    assert.equal(20, handlerCalledCount);
  });

  should("cancel a count prefix", () => {
    sendKeyboardEvent("2");
    sendKeyboardEvent("z");
    sendKeyboardEvent("m");
    assert.equal(true, handlerCalled);
    assert.equal(null, handlerCalledCount);
  });

  should("accept a count prefix for multi-key command mappings", () => {
    sendKeyboardEvent("5");
    sendKeyboardEvent("z");
    sendKeyboardEvent("p");
    assert.equal(5, handlerCalledCount);
  });

  should("cancel a key prefix", () => {
    sendKeyboardEvent("z");
    assert.equal(false, handlerCalled);
    sendKeyboardEvent("m");
    assert.equal(true, handlerCalled);
  });

  should("cancel a count prefix after a prefix key", () => {
    sendKeyboardEvent("2");
    sendKeyboardEvent("z");
    sendKeyboardEvent("m");
    assert.equal(null, handlerCalledCount);
  });

  should("cancel a prefix key on escape", () => {
    sendKeyboardEvent("z");
    sendKeyboardEvent("Escape", "keydown");
    sendKeyboardEvent("p");
    assert.equal(0, handlerCalledCount);
  });
});

context("Normal mode", () => {
  setup(() => initializeModeState());

  should("invoke commands for mapped keys", () => {
    sendKeyboardEvent("m");
    assert.equal("m", commandName);
  });

  should("invoke commands for mapped keys with a mapped prefix", () => {
    sendKeyboardEvent("z");
    sendKeyboardEvent("m");
    assert.equal("m", commandName);
  });

  should("invoke commands for mapped keys with an unmapped prefix", () => {
    sendKeyboardEvent("a");
    sendKeyboardEvent("m");
    assert.equal("m", commandName);
  });

  should("not invoke commands for pass keys", () => {
    sendKeyboardEvent("p");
    assert.equal(null, commandName);
  });

  should("not invoke commands for pass keys with an unmapped prefix", () => {
    sendKeyboardEvent("a");
    sendKeyboardEvent("p");
    assert.equal(null, commandName);
  });

  should("invoke commands for pass keys with a count", () => {
    sendKeyboardEvent("1");
    sendKeyboardEvent("p");
    assert.equal("p", commandName);
  });

  should("invoke commands for pass keys with a key queue", () => {
    sendKeyboardEvent("z");
    sendKeyboardEvent("p");
    assert.equal("zp", commandName);
  });

  should("accept count prefixes of length 1", () => {
    sendKeyboardEvent("2");
    sendKeyboardEvent("m");
    assert.equal(2, commandCount);
  });

  should("accept count prefixes of length 2", () => {
    sendKeyboardEvents("12");
    sendKeyboardEvent("m");
    assert.equal(12, commandCount);
  });

  should("get the correct count for mixed inputs (single key)", () => {
    sendKeyboardEvent("2");
    sendKeyboardEvent("z");
    sendKeyboardEvent("m");
    assert.equal(null, commandCount);
  });

  should("get the correct count for mixed inputs (multi key)", () => {
    sendKeyboardEvent("2");
    sendKeyboardEvent("z");
    sendKeyboardEvent("p");
    assert.equal(2, commandCount);
  });

  should("get the correct count for mixed inputs (multi key, duplicates)", () => {
    sendKeyboardEvent("2");
    sendKeyboardEvent("z");
    sendKeyboardEvent("z");
    sendKeyboardEvent("p");
    assert.equal(null, commandCount);
  });

  should("get the correct count for mixed inputs (with leading mapped keys)", () => {
    sendKeyboardEvent("z");
    sendKeyboardEvent("2");
    sendKeyboardEvent("m");
    assert.equal(2, commandCount);
  });

  should("get the correct count for mixed inputs (with leading unmapped keys)", () => {
    sendKeyboardEvent("a");
    sendKeyboardEvent("2");
    sendKeyboardEvent("m");
    assert.equal(2, commandCount);
  });

  should("not get a count after unmapped keys", () => {
    sendKeyboardEvent("2");
    sendKeyboardEvent("a");
    sendKeyboardEvent("m");
    assert.equal(null, commandCount);
  });

  should("get the correct count after unmapped keys", () => {
    sendKeyboardEvent("2");
    sendKeyboardEvent("a");
    sendKeyboardEvent("3");
    sendKeyboardEvent("m");
    assert.equal(3, commandCount);
  });

  should("not handle unmapped keys", () => {
    sendKeyboardEvent("u");
    assert.equal(null, commandCount);
  });
});

context("Insert mode", () => {
  let insertMode;

  setup(() => {
    initializeModeState();
    insertMode = new InsertMode({ global: true });
  });

  should("exit on escape", () => {
    assert.isTrue(insertMode.modeIsActive);
    sendKeyboardEvent("Escape", "keydown");
    assert.isFalse(insertMode.modeIsActive);
  });

  should("resume normal mode after leaving insert mode", () => {
    assert.equal(null, commandName);
    insertMode.exit();
    sendKeyboardEvent("m");
    assert.equal("m", commandName);
  });
});

// With the Russian layout active and ignoreKeyboardLayout on, command keys are read by their
// physical key, while text typed in insert mode reaches the page unchanged.
context("Russian keyboard layout with ignoreKeyboardLayout", () => {
  // Cyrillic characters on the same physical keys as the US letters/punctuation used below.
  const ruCodes = { "ь": "KeyM", "я": "KeyZ", "з": "KeyP", "ж": "Semicolon", "о": "KeyJ" };
  const sendRuKey = (key) =>
    sendKeyboardEvent(key, "keydown", { code: ruCodes[key] ?? `Digit${key}` });

  setup(() => {
    initializeModeState();
    stubSettings("ignoreKeyboardLayout", true);
  });

  should("invoke commands for mapped keys", () => {
    sendRuKey("ь");
    assert.equal("m", commandName);
  });

  should("accept a count", () => {
    sendRuKey("5");
    sendRuKey("ь");
    assert.equal("m", commandName);
    assert.equal(5, commandCount);
  });

  should("invoke multi-key commands, with a count", () => {
    sendRuKey("1");
    sendRuKey("2");
    sendRuKey("я");
    sendRuKey("з");
    assert.equal("zp", commandName);
    assert.equal(12, commandCount);
  });

  should("invoke mappings containing punctuation", () => {
    const normalMode = initializeModeState();
    normalMode.setKeyMapping({ ";": { j: { options: {}, command: ";j" } } });
    sendRuKey("ж");
    sendRuKey("о");
    assert.equal(";j", commandName);
  });

  should("not translate keys typed in insert mode", () => {
    new InsertMode({ global: true });
    const passedToPage = sendRuKey("ь");
    assert.isTrue(passedToPage);
    assert.equal(null, commandName);
  });
});

context("Escape with a multi-tab selection", () => {
  let sent;

  setup(() => {
    initializeModeState();
    sent = [];
    stub(chrome.runtime, "sendMessage", (message) => sent.push(message.handler));
  });

  teardown(() => TabSelection.count = 1);

  should("clear the selection, and not pass the Escape to the page", () => {
    messageHandlers.tabSelectionChanged({ count: 3 });
    const passedToPage = sendKeyboardEvent("Escape");
    assert.isFalse(passedToPage);
    assert.equal(["clearTabSelection"], sent);
    // A second Escape reaches the page.
    assert.isTrue(sendKeyboardEvent("Escape"));
    assert.equal(["clearTabSelection"], sent);
  });

  should("pass the Escape to the page without a selection", () => {
    messageHandlers.tabSelectionChanged({ count: 1 });
    assert.isTrue(sendKeyboardEvent("Escape"));
    assert.equal([], sent);
  });

  should("first reset a partly typed command", () => {
    messageHandlers.tabSelectionChanged({ count: 2 });
    sendKeyboardEvent("z");
    sendKeyboardEvent("Escape");
    assert.equal([], sent);
    sendKeyboardEvent("Escape");
    assert.equal(["clearTabSelection"], sent);
  });

  should("first leave insert mode", () => {
    messageHandlers.tabSelectionChanged({ count: 2 });
    const insertMode = new InsertMode({ global: true });
    sendKeyboardEvent("Escape");
    assert.isFalse(insertMode.modeIsActive);
    assert.equal([], sent);
    sendKeyboardEvent("Escape");
    assert.equal(["clearTabSelection"], sent);
  });

  should("forget the selection when the tab is hidden", () => {
    messageHandlers.tabSelectionChanged({ count: 2 });
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    try {
      document.dispatchEvent(new Event("visibilitychange"));
    } finally {
      delete document.hidden;
    }
    assert.isTrue(sendKeyboardEvent("Escape"));
    assert.equal([], sent);
  });
});

context("Triggering insert mode", () => {
  setup(() => {
    initializeModeState();

    const testContent = `<input type='text' id='first'/> \
<input style='display:none;' id='second'/> \
<input type='password' id='third' value='some value'/> \
<p id='fourth' contenteditable='true'/> \
<p id='fifth'/>`;
    document.getElementById("test-div").innerHTML = testContent;
  });

  teardown(() => {
    if (document.activeElement != null) {
      document.activeElement.blur();
    }
    document.getElementById("test-div").innerHTML = "";
  });

  should("trigger insert mode on focus of text input", () => {
    assert.isFalse(InsertMode.permanentInstance.isActive());
    document.getElementById("first").focus();
    assert.isTrue(InsertMode.permanentInstance.isActive());
  });

  should("trigger insert mode on focus of password input", () => {
    assert.isFalse(InsertMode.permanentInstance.isActive());
    document.getElementById("third").focus();
    assert.isTrue(InsertMode.permanentInstance.isActive());
  });

  should("trigger insert mode on focus of contentEditable elements", () => {
    assert.isFalse(InsertMode.permanentInstance.isActive());
    document.getElementById("fourth").focus();
    assert.isTrue(InsertMode.permanentInstance.isActive());
  });

  should("not trigger insert mode on other elements", () => {
    assert.isFalse(InsertMode.permanentInstance.isActive());
    document.getElementById("fifth").focus();
    assert.isFalse(InsertMode.permanentInstance.isActive());
  });
});

// NOTE(philc): I'm disabling the caret and visual mode tests because I think they're fallen into
// disrepair, or we merged changes to master and neglected to update the tests. We should return to
// these and fix+re-enable them.

// context("Caret mode",
//   setup(() => {
//     document.getElementById("test-div").innerHTML = `\
// <p><pre>
//   It is an ancient Mariner,
//   And he stoppeth one of three.
//   By thy long grey beard and glittering eye,
//   Now wherefore stopp'st thou me?
// </pre></p>\
// `;
//     initializeModeState();
//     this.initialVisualMode = new VisualMode;
//   });

//   teardown(() => document.getElementById("test-div").innerHTML = ""),

//   should("enter caret mode", () => {
//     assert.isFalse(this.initialVisualMode.modeIsActive);
//     assert.equal("I", getSelection());
//   });

//   should("exit caret mode on escape", () => {
//     sendKeyboardEvent("Escape", "keydown");
//     assert.equal("", getSelection());
//   });

//   should("move caret with l and h", () => {
//     assert.equal("I", getSelection());
//     sendKeyboardEvent("l");
//     assert.equal("t", getSelection());
//     sendKeyboardEvent("h");
//     assert.equal("I", getSelection());
//   });

//   should("move caret with w and b", () => {
//     assert.equal("I", getSelection());
//     sendKeyboardEvent("w");
//     assert.equal("i", getSelection());
//     sendKeyboardEvent("b");
//     assert.equal("I", getSelection());
//   });

//   should("move caret with e", () => {
//     assert.equal("I", getSelection());
//     sendKeyboardEvent("e");
//     assert.equal(" ", getSelection());
//     sendKeyboardEvent("e");
//     assert.equal(" ", getSelection());
//   });

//   should("move caret with j and k", () => {
//     assert.equal("I", getSelection());
//     sendKeyboardEvent("j");
//     assert.equal("A", getSelection());
//     sendKeyboardEvent("k");
//     assert.equal("I", getSelection());
//   });

//   should("re-use an existing selection", () => {
//     assert.equal("I", getSelection());
//     sendKeyboardEvents("ww");
//     assert.equal("a", getSelection());
//     sendKeyboardEvent("Escape", "keydown");
//     new VisualMode;
//     assert.equal("a", getSelection());
//   });

//   should("not move the selection on caret/visual mode toggle", () => {
//     sendKeyboardEvents("ww");
//     assert.equal("a", getSelection());
//     for (let key of "vcvcvc".split()) {
//       sendKeyboardEvent(key);
//       assert.equal("a", getSelection());
//     }
//   })
// );

// // TODO(philc): Re-enable
// context("Visual mode",
//   setup(() => {
//     document.getElementById("test-div").innerHTML = `\
// <p><pre>
//   It is an ancient Mariner,
//   And he stoppeth one of three.
//   By thy long grey beard and glittering eye,
//   Now wherefore stopp'st thou me?
// </pre></p>\
// `;
//     initializeModeState();
//     this.initialVisualMode = new VisualMode;
//     sendKeyboardEvent("w");
//     sendKeyboardEvent("w");
//     // We should now be at the "a" of "an".
//     sendKeyboardEvent("v");
//   });

//   teardown(() => document.getElementById("test-div").innerHTML = ""),

//   should("select word with e", () => {
//     assert.equal("a", getSelection());
//     sendKeyboardEvent("e");
//     assert.equal("an", getSelection());
//     sendKeyboardEvent("e");
//     assert.equal("an ancient", getSelection());
//   });

//   should("select opposite end of the selection with o", () => {
//     assert.equal("a", getSelection());
//     sendKeyboardEvent("e");
//     assert.equal("an", getSelection());
//     sendKeyboardEvent("e");
//     assert.equal("an ancient", getSelection());
//     sendKeyboardEvents("ow");
//     assert.equal("ancient", getSelection());
//     sendKeyboardEvents("oe");
//     assert.equal("ancient Mariner", getSelection());
//   });

//   should("accept a count", () => {
//     assert.equal("a", getSelection());
//     sendKeyboardEvents("2e");
//     assert.equal("an ancient", getSelection());
//   });

//   should("select a word", () => {
//     assert.equal("a", getSelection());
//     sendKeyboardEvents("aw");
//     assert.equal("an", getSelection());
//   });

//   should("select a word with a count", () => {
//     assert.equal("a", getSelection());
//     sendKeyboardEvents("2aw");
//     assert.equal("an ancient", getSelection());
//   });

//   should("select a word with a count", () => {
//     assert.equal("a", getSelection());
//     sendKeyboardEvents("2aw");
//     assert.equal("an ancient", getSelection());
//   });

//   should("select to start of line", () => {
//     assert.equal("a", getSelection());
//     sendKeyboardEvents("0");
//     assert.equal("It is", getSelection().trim());
//   });

//   should("select to end of line", () => {
//     assert.equal("a", getSelection());
//     sendKeyboardEvents("$");
//     assert.equal("an ancient Mariner,", getSelection());
//   });

//   should("re-enter caret mode", () => {
//     assert.equal("a", getSelection());
//     sendKeyboardEvents("cww");
//     assert.equal("M", getSelection());
//   })
// );

const createMode = (options) => {
  const mode = new Mode();
  mode.init(options);
  return mode;
};

context("Mode utilities", () => {
  setup(() => {
    initializeModeState();

    const testContent = `<input type='text' id='first'/> \
<input style='display:none;' id='second'/> \
<input type='password' id='third' value='some value'/>`;
    document.getElementById("test-div").innerHTML = testContent;
  });

  teardown(() => document.getElementById("test-div").innerHTML = "");

  should("not have duplicate singletons", () => {
    let mode;
    let count = 0;
    class Test extends Mode {
      constructor() {
        count += 1;
        super();
        super.init({ singleton: "test" });
      }
      exit() {
        count -= 1;
        return super.exit();
      }
    }
    assert.isTrue(count === 0);
    for (let i = 1; i <= 10; i++) {
      mode = new Test();
      assert.isTrue(count === 1);
    }
    mode.exit();
    assert.isTrue(count === 0);
  });

  should("exit on escape", () => {
    const test = createMode({ exitOnEscape: true });
    assert.isTrue(test.modeIsActive);
    sendKeyboardEvent("Escape", "keydown");
    assert.isFalse(test.modeIsActive);
  });

  should("not exit on escape if not enabled", () => {
    const test = createMode({ exitOnEscape: false });
    assert.isTrue(test.modeIsActive);
    sendKeyboardEvent("Escape", "keydown");
    assert.isTrue(test.modeIsActive);
  });

  should("exit on blur", () => {
    const element = document.getElementById("first");
    element.focus();
    const test = createMode({ exitOnBlur: element });
    assert.isTrue(test.modeIsActive);
    element.blur();
    assert.isFalse(test.modeIsActive);
  });

  should("not exit on blur if not enabled", () => {
    const element = document.getElementById("first");
    element.focus();
    const test = createMode({ exitOnBlur: false });
    assert.isTrue(test.modeIsActive);
    element.blur();
    assert.isTrue(test.modeIsActive);
  });
});

context("PostFindMode", () => {
  let postFindMode;

  setup(() => {
    initializeModeState();
    const testContent = "<input type='text' id='first'/>";
    document.getElementById("test-div").innerHTML = testContent;
    document.getElementById("first").focus();
    postFindMode = new PostFindMode();
  });

  teardown(() => document.getElementById("test-div").innerHTML = ""),
    should("be a singleton", () => {
      assert.isTrue(postFindMode.modeIsActive);
      new PostFindMode();
      assert.isFalse(postFindMode.modeIsActive);
    });

  should("suppress unmapped printable keys", () => {
    sendKeyboardEvent("a");
    assert.equal(null, commandCount);
  });

  should("be deactivated on click events", () => {
    handlerStack.bubbleEvent("click", { target: document.activeElement });
    assert.isFalse(postFindMode.modeIsActive);
  });

  should("enter insert mode on immediate escape", () => {
    sendKeyboardEvent("Escape", "keydown");
    assert.equal(null, commandCount);
    assert.isFalse(postFindMode.modeIsActive);
  });

  should("not enter insert mode on subsequent escapes", () => {
    sendKeyboardEvent("a");
    sendKeyboardEvent("Escape", "keydown");
    assert.isTrue(postFindMode.modeIsActive);
  });
});

context("LinkHintsMode confirmation", () => {
  let exitIsSuccess;

  setup(() => {
    initializeModeState();
    document.getElementById("test-div").innerHTML = "<a>test</a><a>tress</a>";
    stubSettings("filterLinkHints", true);
    stub(globalThis, "windowIsFocused", () => true);
    exitIsSuccess = "not called";
    HintCoordinator.onExit = [(isSuccess) => exitIsSuccess = isSuccess];
  });

  teardown(() => {
    if (HintCoordinator.linkHintsMode != null) {
      HintCoordinator.exit({ isSuccess: false });
    }
    document.getElementById("test-div").innerHTML = "";
  });

  context("waitForEnterForFilteredHints", () => {
    let mode;

    setup(() => {
      stubSettings("waitForEnterForFilteredHints", true);
      mode = activateLinkHintsMode();
      sendKeyboardEvent("t");
      sendKeyboardEvent("e"); // Uniquely matches "test"; "tress" doesn't start with "te".
    });

    should("show the confirmation indicator, not the regular mode indicator", () => {
      assert.equal("Hit <Enter> to proceed...", mode.hintMode.options.indicator);
    });

    should("confirm successfully on Enter", () => {
      sendKeyboardEvent("Enter", "keydown");
      assert.equal(true, exitIsSuccess);
    });

    should("cancel on Escape", () => {
      sendKeyboardEvent("Escape", "keydown");
      assert.equal(false, exitIsSuccess);
    });

    should("not exit on other keyboard events", () => {
      sendKeyboardEvents("xyz");
      assert.equal("not called", exitIsSuccess);
    });
  });

  context("timeout variant (waitForEnterForFilteredHints off)", () => {
    setup(() => {
      stubSettings("waitForEnterForFilteredHints", false);
      // Fire the confirmation delay immediately, rather than waiting on a real 200ms timer.
      stub(Utils, "setTimeout", (_delay, fn) => fn());
      activateLinkHintsMode();
    });

    should("confirm successfully once the user stops typing", () => {
      sendKeyboardEvent("t");
      sendKeyboardEvent("e"); // Uniquely matches "test"; the (stubbed, immediate) timer then fires.
      assert.equal(true, exitIsSuccess);
    });
  });
});

context("GrabBackFocus", () => {
  setup(() => {
    const testContent = "<input type='text' value='some value' id='input'/>";
    document.getElementById("test-div").innerHTML = testContent;
    stubSettings("grabBackFocus", true);
  });

  teardown(() => document.getElementById("test-div").innerHTML = ""),
    should("blur an already focused input", () => {
      document.getElementById("input").focus();
      assert.isTrue(document.activeElement);
      assert.isTrue(DomUtils.isEditable(document.activeElement));
      initializeModeState();
      assert.isTrue(document.activeElement);
      assert.isFalse(DomUtils.isEditable(document.activeElement));
    });

  should("blur a newly focused input", () => {
    initializeModeState();
    document.getElementById("input").focus();
    assert.isTrue(document.activeElement);
    assert.isFalse(DomUtils.isEditable(document.activeElement));
  });

  should("exit on a key event", () => {
    initializeModeState();
    sendKeyboardEvent("a");
    document.getElementById("input").focus();
    assert.isTrue(document.activeElement);
    assert.isTrue(DomUtils.isEditable(document.activeElement));
  });

  should("exit on a mousedown event", () => {
    initializeModeState();
    handlerStack.bubbleEvent("mousedown", { target: document.body });
    document.getElementById("input").focus();
    assert.isTrue(document.activeElement);
    assert.isTrue(DomUtils.isEditable(document.activeElement));
  });
});

// J / K and other Vimium commands which switch tabs tell the new tab, so that it starts in normal
// mode even when the page focuses a text box.
context("Arriving in a tab through a Vimium command", () => {
  let input;

  setup(() => {
    document.getElementById("test-div").innerHTML = "<input type='text' id='input'/>";
    input = document.getElementById("input");
    stubSettings("grabBackFocus", false);
    initializeModeState();
  });

  teardown(() => {
    document.activeElement?.blur();
    document.getElementById("test-div").innerHTML = "";
  });

  should("blur the focused input and handle the next key in normal mode", () => {
    input.focus();
    messageHandlers.activatedByVimium();
    assert.isFalse(DomUtils.isEditable(document.activeElement));
    sendKeyboardEvent("m");
    assert.equal("m", commandName);
  });

  should("blur an input the page focuses before the user types", () => {
    messageHandlers.activatedByVimium();
    input.focus();
    assert.isFalse(DomUtils.isEditable(document.activeElement));
  });

  should("let the page focus an input after the user types", () => {
    messageHandlers.activatedByVimium();
    sendKeyboardEvent("m");
    input.focus();
    assert.isTrue(DomUtils.isEditable(document.activeElement));
  });

  should("let the user click into an input", () => {
    messageHandlers.activatedByVimium();
    handlerStack.bubbleEvent("mousedown", { target: input });
    input.focus();
    assert.isTrue(DomUtils.isEditable(document.activeElement));
  });

  should("do nothing where Vimium is disabled", () => {
    isEnabledForUrl = false;
    try {
      input.focus();
      messageHandlers.activatedByVimium();
      assert.isTrue(DomUtils.isEditable(document.activeElement));
    } finally {
      isEnabledForUrl = true;
    }
  });
});

// Keep this context last: unloading resets Vimium's state for the rest of the page.
context("Orphaned content script", () => {
  teardown(() => isEnabledForUrl = true);

  should("unload instead of messaging the background page when checking the URL", async () => {
    let sent = false;
    // This is what chrome.runtime looks like after Vimium was reloaded or reinstalled.
    stub(chrome.runtime, "id", undefined);
    stub(chrome.runtime, "sendMessage", () => {
      sent = true;
      throw new Error("Extension context invalidated.");
    });
    await checkIfEnabledForUrl();
    assert.isFalse(sent);
    assert.isFalse(isEnabledForUrl);
  });
});
