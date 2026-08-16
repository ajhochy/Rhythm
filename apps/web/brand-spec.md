# Rhythm Desktop Agents brand specification

The Agents workbench uses a warm, raised Rhythm desktop shell with dense native-tool proportions, slate information text, and a single periwinkle interaction accent.

## Core OKLch tokens

```css
:root {
  --bg: oklch(0.9585 0.0098 87.47);
  --surface: oklch(0.9972 0.0028 84.56);
  --fg: oklch(0.2795 0.0368 260.03);
  --muted: oklch(0.7107 0.0351 256.79);
  --border: oklch(0.9026 0.0191 83.06);
  --accent: oklch(0.5877 0.1724 273.86);
}
```

These are direct conversions of the verified brief values `#F4F1EA`, `#FFFEFC`, `#1E293B`, `#94A3B8`, `#E5DED1`, and `#5F6FE1`.

## Type stacks

- Display: `Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Body: `Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Mono: `"SFMono-Regular", Consolas, "Liberation Mono", monospace`

## Observed visual rules

1. The application sits on a warm canvas as one raised, softly rounded desktop window.
2. Workbench hierarchy comes from source-list, transcript, and inspector planes separated by quiet one-pixel dividers.
3. Periwinkle marks the selected destination, focused state, and one primary action; it is not decorative fill.
4. Operational data uses compact, tabular mono type while sentences remain in the product sans.
5. Dense controls follow native desktop proportions, with full keyboard focus, expanded session rows, and persistent context.
