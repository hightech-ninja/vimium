const Marks = {
  previousPositionRegisters: ["`", "'"],
  localRegisters: {},
  currentRegistryEntry: null,
  mode: null,

  exit(continuation = null) {
    if (this.mode != null) {
      this.mode.exit();
    }
    this.mode = null;
    if (continuation) {
      return continuation(); // TODO(philc): Is this return necessary?
    }
  },

  // This returns the key which is used for storing mark locations in localStorage.
  getLocationKey(keyChar) {
    return `vimiumMark|${globalThis.location.href.split("#")[0]}|${keyChar}`;
  },

  getMarkString() {
    const mark = {
      scrollX: globalThis.scrollX,
      scrollY: globalThis.scrollY,
      hash: globalThis.location.hash,
    };
    // If scrolling commands scroll an element (e.g. one pane of the page) rather than the document,
    // then also record which element that is, and its position.
    const container = Scroller.activeScrollContainer();
    const locator = container && this.getElementLocator(container);
    if (locator) {
      Object.assign(mark, {
        container: locator,
        containerScrollX: container.scrollLeft,
        containerScrollY: container.scrollTop,
      });
    }
    return JSON.stringify(mark);
  },

  // Returns a description of element's place in the document, from which findElement() can find
  // it again (on this page, or after a reload): its id, if that's unique, and the path of child
  // indexes and tag names from the root element. Returns null for elements in a shadow DOM.
  getElementLocator(element) {
    if (element.getRootNode() !== document) return null;
    const path = [];
    for (let el = element; el !== document.documentElement; el = el.parentElement) {
      path.unshift([Array.prototype.indexOf.call(el.parentElement.children, el), el.localName]);
    }
    const id = (element.id && (document.getElementById(element.id) === element))
      ? element.id
      : null;
    return { id, path };
  },

  // Finds the element described by getElementLocator(), or returns null.
  findElement({ id, path }) {
    const localName = path.length > 0 ? path[path.length - 1][1] : "html";
    const elementWithId = id ? document.getElementById(id) : null;
    if (elementWithId?.localName === localName) return elementWithId;
    let element = document.documentElement;
    for (const [index, name] of path) {
      element = element.children[index];
      if (element?.localName !== name) return null;
    }
    return element;
  },

  // Scrolls to a position recorded by getMarkString().
  restorePosition(position) {
    const container = position.container ? this.findElement(position.container) : null;
    if (position.hash && (position.scrollX === 0) && (position.scrollY === 0) && !container) {
      globalThis.location.hash = position.hash;
      return;
    }
    globalThis.scrollTo(position.scrollX, position.scrollY);
    if (container) {
      // Scrolling commands should continue with the pane the mark is in.
      Scroller.selectElement(container);
      container.scrollLeft = position.containerScrollX;
      container.scrollTop = position.containerScrollY;
    }
  },

  setPreviousPosition() {
    const markString = this.getMarkString();
    for (const reg of this.previousPositionRegisters) {
      this.localRegisters[reg] = markString;
    }
  },

  showMessage(message, keyChar) {
    HUD.show(`${message} \"${keyChar}\".`, 1000);
  },

  // If <Shift> is depressed, then it's a global mark, otherwise it's a local mark. This is
  // consistent vim's [A-Z] for global marks and [a-z] for local marks. However, it also admits
  // other non-Latin characters. The exceptions are "`" and "'", which are always considered local
  // marks. The "swap" command option inverts global and local marks.
  isGlobalMark(event, keyChar) {
    let shiftKey = event.shiftKey;
    if (this.currentRegistryEntry.options.swap) {
      shiftKey = !shiftKey;
    }
    return shiftKey && !this.previousPositionRegisters.includes(keyChar);
  },

  activateCreateMode(_count, { registryEntry }) {
    this.currentRegistryEntry = registryEntry;
    this.mode = new Mode();
    this.mode.init({
      name: "create-mark",
      indicator: "Create mark...",
      exitOnEscape: true,
      suppressAllKeyboardEvents: true,
      keydown: (event) => {
        if (KeyboardUtils.isPrintable(event)) {
          const keyChar = KeyboardUtils.getKeyChar(event);
          this.exit(() => {
            if (this.isGlobalMark(event, keyChar)) {
              // We record the current scroll position, but only if this is the top frame within the
              // tab. Otherwise, we'll fetch the scroll position of the top frame from the
              // background page later.
              let scrollX, scrollY;
              if (DomUtils.isTopFrame()) {
                [scrollX, scrollY] = [globalThis.scrollX, globalThis.scrollY];
              }
              chrome.runtime.sendMessage({
                handler: "createMark",
                markName: keyChar,
                scrollX,
                scrollY,
              }, () => this.showMessage("Created global mark", keyChar));
            } else {
              localStorage[this.getLocationKey(keyChar)] = this.getMarkString();
              this.showMessage("Created local mark", keyChar);
            }
          });
          return handlerStack.suppressEvent;
        }
      },
    });
  },

  activateGotoMode(_count, { registryEntry }) {
    this.currentRegistryEntry = registryEntry;
    this.mode = new Mode();
    this.mode.init({
      name: "goto-mark",
      indicator: "Go to mark...",
      exitOnEscape: true,
      suppressAllKeyboardEvents: true,
      keydown: (event) => {
        if (KeyboardUtils.isPrintable(event)) {
          this.exit(() => {
            const keyChar = KeyboardUtils.getKeyChar(event);
            if (this.isGlobalMark(event, keyChar)) {
              // This key must match @getLocationKey() in the back end.
              const key = `vimiumGlobalMark|${keyChar}`;
              chrome.storage.local.get(key, function (items) {
                if (key in items) {
                  chrome.runtime.sendMessage({ handler: "gotoMark", markName: keyChar });
                  HUD.show(`Jumped to global mark '${keyChar}'`, 1000);
                } else {
                  HUD.show(`Global mark not set '${keyChar}'`, 1000);
                }
              });
            } else {
              const markString = this.localRegisters[keyChar] != null
                ? this.localRegisters[keyChar]
                : localStorage[this.getLocationKey(keyChar)];
              if (markString != null) {
                this.setPreviousPosition();
                this.restorePosition(JSON.parse(markString));
                this.showMessage("Jumped to local mark", keyChar);
              } else {
                this.showMessage("Local mark not set", keyChar);
              }
            }
          });
          return handlerStack.suppressEvent;
        }
      },
    });
  },
};

globalThis.Marks = Marks;
