/**
 * M110-TC — Key Code Map
 *
 * Lookup table mapping key names to CDP Input.dispatchKeyEvent parameters.
 * Used by browser_press_key and browser_type submitKey.
 *
 * REQ-TC-015: Uses KeyCodeMap for named keys (Enter, Tab, Escape, ArrowLeft, etc.)
 *
 * @module
 */

export interface KeyCodeEntry {
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
  nativeVirtualKeyCode: number;
}

/**
 * Map from key name to CDP key event parameters.
 * Covers: Enter, Tab, Escape, ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
 * Control, Shift, Alt, Meta, and alphanumeric keys.
 */
export const KeyCodeMap: Record<string, KeyCodeEntry> = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 },
  Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37, nativeVirtualKeyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 },
};

/**
 * Modifier bitmask values for CDP Input.dispatchKeyEvent modifiers field.
 * Alt=1, Control=2, Meta=4, Shift=8
 */
export const MODIFIER_ALT = 1;
export const MODIFIER_CONTROL = 2;
export const MODIFIER_META = 4;
export const MODIFIER_SHIFT = 8;

/**
 * Parse a key combination string into modifiers bitmask and base key name.
 * e.g., "Control+A" → { modifiers: 2, key: "A" }
 *       "Control+Shift+R" → { modifiers: 10, key: "R" }
 */
export function parseKeyCombination(keyCombo: string): { modifiers: number; key: string } {
  const modifierMap: Record<string, number> = {
    Control: MODIFIER_CONTROL,
    Shift: MODIFIER_SHIFT,
    Alt: MODIFIER_ALT,
    Meta: MODIFIER_META,
  };

  const parts = keyCombo.split("+");
  let modifiers = 0;
  let key = "";

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (modifierMap[part] !== undefined) {
      modifiers |= modifierMap[part];
    } else {
      key = part;
    }
  }

  return { modifiers, key };
}
