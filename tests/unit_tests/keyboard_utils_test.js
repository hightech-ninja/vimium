import "./test_helper.js";
import "../../lib/settings.js";
import "../../lib/keyboard_utils.js";

// Keydown events as Chrome produces them with the Russian (ЙЦУКЕН) layout active: event.key is the
// Cyrillic character and event.code is the physical (US QWERTY) key.
const ruKey = (key, code, modifiers = {}) =>
  Object.assign({ type: "keydown", key, code, shiftKey: false }, modifiers);

context("KeyboardUtils with a Russian layout", () => {
  let platform;

  setup(async () => {
    await Settings.load();
    platform = KeyboardUtils.platform;
    KeyboardUtils.platform = "Linux";
  });

  teardown(async () => {
    KeyboardUtils.platform = platform;
    await Settings.clear();
  });

  should("read keys by their physical key by default", () => {
    assert.equal(true, Settings.get("ignoreKeyboardLayout"));
    assert.equal("j", KeyboardUtils.getKeyCharString(ruKey("о", "KeyJ")));
    assert.equal("G", KeyboardUtils.getKeyCharString(ruKey("П", "KeyG", { shiftKey: true })));
  });

  should("read the Cyrillic character when ignoreKeyboardLayout is off", async () => {
    await Settings.set("ignoreKeyboardLayout", false);
    assert.equal("о", KeyboardUtils.getKeyChar(ruKey("о", "KeyJ")));
    assert.equal("о", KeyboardUtils.getKeyCharString(ruKey("о", "KeyJ")));
  });

  context("ignoreKeyboardLayout on", () => {
    setup(async () => {
      await Settings.set("ignoreKeyboardLayout", true);
    });

    should("read letters by their physical key", () => {
      const keys = [["й", "KeyQ", "q"], ["о", "KeyJ", "j"], ["л", "KeyK", "k"], ["п", "KeyG", "g"]];
      for (const [key, code, expected] of keys) {
        assert.equal(expected, KeyboardUtils.getKeyCharString(ruKey(key, code)));
      }
    });

    should("read shifted letters as uppercase", () => {
      assert.equal("G", KeyboardUtils.getKeyCharString(ruKey("П", "KeyG", { shiftKey: true })));
      assert.equal("T", KeyboardUtils.getKeyCharString(ruKey("Е", "KeyT", { shiftKey: true })));
    });

    should("read the keys holding Russian letters where the US layout has punctuation", () => {
      const keys = [
        ["ё", "Backquote", "`"],
        ["х", "BracketLeft", "["],
        ["ъ", "BracketRight", "]"],
        ["ж", "Semicolon", ";"],
        ["э", "Quote", "'"],
        ["б", "Comma", ","],
        ["ю", "Period", "."],
        [".", "Slash", "/"],
      ];
      for (const [key, code, expected] of keys) {
        assert.equal(expected, KeyboardUtils.getKeyCharString(ruKey(key, code)));
      }
    });

    should("read shifted punctuation keys as the US symbols", () => {
      const keys = [
        ["Ё", "Backquote", "~"],
        ["Ж", "Semicolon", ":"],
        ["Б", "Comma", "<"],
        ["Ю", "Period", ">"],
        [",", "Slash", "?"],
        ["№", "Digit3", "#"],
        ['"', "Digit2", "@"],
        [";", "Digit4", "$"],
      ];
      for (const [key, code, expected] of keys) {
        const event = ruKey(key, code, { shiftKey: true });
        assert.equal(expected, KeyboardUtils.getKeyCharString(event));
      }
    });

    should("read digits for counts", () => {
      assert.equal("5", KeyboardUtils.getKeyCharString(ruKey("5", "Digit5")));
      assert.equal("0", KeyboardUtils.getKeyCharString(ruKey("0", "Digit0")));
    });

    should("read modifier combinations by their physical key", () => {
      const event = ruKey("л", "KeyK", { ctrlKey: true });
      assert.equal("<c-k>", KeyboardUtils.getKeyCharString(event));
    });

    should("treat ctrl+х (the [ key) as Escape", () => {
      assert.isTrue(KeyboardUtils.isEscape(ruKey("х", "BracketLeft", { ctrlKey: true })));
    });

    should("treat Cyrillic keys as printable", () => {
      assert.isTrue(KeyboardUtils.isPrintable(ruKey("о", "KeyJ")));
    });

    should("still use event.key for the numpad", () => {
      assert.equal("5", KeyboardUtils.getKeyChar(ruKey("5", "Numpad5")));
    });
  });
});
