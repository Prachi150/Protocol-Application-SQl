# Faclon I/OConnect — Design System Reference

A portable reference for replicating the LSG app's visual language in any web UI. Paste this document into an AI prompt or use it as a human-readable spec.

**Stack this was built with:** React 18 · Vite 6 · Tailwind CSS 3 · Shadcn/UI (Radix primitives) · IBM Plex fonts · lucide-react icons.

---

## 1. Design Language Overview

Clean, data-dense industrial UI for IoT/edge device management. Panels with subtle 1 px borders replace heavy shadows. A strong blue accent (#2f55d4) drives interactive states in light mode; dark mode switches to an ocher/orange accent (#e8650a, text: #fb923c) for warmth against the cool dark background. IBM Plex Sans for UI text; IBM Plex Mono for all technical values (IPs, timestamps, config). Full light/dark mode via CSS variables — activated by toggling the `dark` class on `<html>`. Transitions are uniformly fast (130 ms) for a responsive feel without flashiness.

---

## 2. Setup

### Fonts

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
```

### CSS Variables — Light Mode (`:root`)

```css
:root {
  /* Shadcn/Radix required tokens (HSL format) */
  --background:             228 33% 97%;
  --foreground:             221 39% 11%;
  --card:                   0 0% 100%;
  --card-foreground:        221 39% 11%;
  --popover:                0 0% 100%;
  --popover-foreground:     221 39% 11%;
  --primary:                224 64% 51%;
  --primary-foreground:     0 0% 100%;
  --secondary:              220 14% 94%;
  --secondary-foreground:   221 39% 11%;
  --muted:                  220 14% 94%;
  --muted-foreground:       220 9% 46%;
  --accent:                 220 14% 94%;
  --accent-foreground:      221 39% 11%;
  --destructive:            0 72% 51%;
  --destructive-foreground: 0 0% 100%;
  --border:                 220 13% 90%;
  --input:                  220 13% 90%;
  --ring:                   224 64% 51%;
  --radius:                 0.5rem;

  /* App design tokens */
  --app-bg:            #F4F6FB;
  --app-surface:       #FFFFFF;
  --app-elevated:      #EDF0F7;
  --app-border:        rgba(0, 0, 0, 0.09);
  --app-border-mid:    rgba(0, 0, 0, 0.14);
  --app-accent:        #2f55d4;
  --app-accent-sub:    rgba(47, 85, 212, 0.09);
  --app-accent-border: rgba(47, 85, 212, 0.22);
  --app-accent-text:   #2f55d4;
  --app-success:       #15803d;
  --app-success-sub:   rgba(21, 128, 61, 0.09);
  --app-warning:       #b45309;
  --app-warning-sub:   rgba(180, 83, 9, 0.09);
  --app-danger:        #b91c1c;
  --app-danger-sub:    rgba(185, 28, 28, 0.09);
  --app-neutral-sub:   rgba(0, 0, 0, 0.05);
  --app-text-1:        #111827;
  --app-text-2:        #4B5563;
  --app-text-3:        #9CA3AF;
}
```

### CSS Variables — Dark Mode (`.dark`)

```css
.dark {
  /* Shadcn/Radix required tokens */
  --background:             240 7% 7%;
  --foreground:             217 31% 92%;
  --card:                   240 6% 11%;
  --card-foreground:        217 31% 92%;
  --popover:                240 6% 11%;
  --popover-foreground:     217 31% 92%;
  --primary:                228 83% 62%;
  --primary-foreground:     0 0% 100%;
  --secondary:              240 5% 16%;
  --secondary-foreground:   217 31% 92%;
  --muted:                  240 5% 16%;
  --muted-foreground:       215 16% 57%;
  --accent:                 240 5% 16%;
  --accent-foreground:      217 31% 92%;
  --destructive:            0 91% 71%;
  --destructive-foreground: 240 7% 7%;
  --border:                 240 4% 18%;
  --input:                  240 4% 18%;
  --ring:                   228 83% 62%;

  /* App design tokens */
  --app-bg:            #111113;
  --app-surface:       #1c1c1f;
  --app-elevated:      #252528;
  --app-border:        rgba(255, 255, 255, 0.08);
  --app-border-mid:    rgba(255, 255, 255, 0.13);
  --app-accent:        #e8650a;
  --app-accent-sub:    rgba(232, 101, 10, 0.12);
  --app-accent-border: rgba(232, 101, 10, 0.28);
  --app-accent-text:   #fb923c;
  --app-success:       #34d399;
  --app-success-sub:   rgba(52, 211, 153, 0.10);
  --app-warning:       #fbbf24;
  --app-warning-sub:   rgba(251, 191, 36, 0.10);
  --app-danger:        #f87171;
  --app-danger-sub:    rgba(248, 113, 113, 0.10);
  --app-neutral-sub:   rgba(255, 255, 255, 0.05);
  --app-text-1:        #e8edf5;
  --app-text-2:        #8b95a9;
  --app-text-3:        #576070;
}
```

### Base CSS

```css
*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  font-family: 'IBM Plex Sans', sans-serif;
  background: var(--app-bg);
  color: var(--app-text-1);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.mono { font-family: 'IBM Plex Mono', monospace; }
```

### Tailwind Config Snippet

```js
// tailwind.config.js
export default {
  darkMode: ['class'],          // dark mode: add class="dark" to <html>
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',                    // 8px
        md: 'calc(var(--radius) - 2px)',        // 6px
        sm: 'calc(var(--radius) - 4px)',        // 4px
      },
      colors: {
        app: {
          bg:           'var(--app-bg)',
          surface:      'var(--app-surface)',
          elevated:     'var(--app-elevated)',
          accent:       'var(--app-accent)',
          'accent-text':'var(--app-accent-text)',
          'accent-sub': 'var(--app-accent-sub)',
          success:      'var(--app-success)',
          warning:      'var(--app-warning)',
          danger:       'var(--app-danger)',
          text1:        'var(--app-text-1)',
          text2:        'var(--app-text-2)',
          text3:        'var(--app-text-3)',
        },
      },
    },
  },
}
```

---

## 3. Color Tokens

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--app-bg` | `#F4F6FB` | `#111113` | Page background |
| `--app-surface` | `#FFFFFF` | `#1c1c1f` | Cards, panels, topbar, sidebar |
| `--app-elevated` | `#EDF0F7` | `#252528` | Input backgrounds, hover states |
| `--app-border` | `rgba(0,0,0,0.09)` | `rgba(255,255,255,0.08)` | Default 1 px borders |
| `--app-border-mid` | `rgba(0,0,0,0.14)` | `rgba(255,255,255,0.13)` | Stronger borders (inputs, buttons) |
| `--app-accent` | `#2f55d4` | `#e8650a` | Primary action color (buttons, active nav) |
| `--app-accent-sub` | `rgba(47,85,212,0.09)` | `rgba(232,101,10,0.12)` | Accent backgrounds, active nav bg |
| `--app-accent-border` | `rgba(47,85,212,0.22)` | `rgba(232,101,10,0.28)` | Accent-tinted borders |
| `--app-accent-text` | `#2f55d4` | `#fb923c` | Accent text (lighter/warmer in dark mode) |
| `--app-success` | `#15803d` | `#34d399` | Success / running / enabled |
| `--app-success-sub` | `rgba(21,128,61,0.09)` | `rgba(52,211,153,0.10)` | Success badge / alert backgrounds |
| `--app-warning` | `#b45309` | `#fbbf24` | Warnings, degraded states |
| `--app-warning-sub` | `rgba(180,83,9,0.09)` | `rgba(251,191,36,0.10)` | Warning badge / alert backgrounds |
| `--app-danger` | `#b91c1c` | `#f87171` | Errors, destructive actions |
| `--app-danger-sub` | `rgba(185,28,28,0.09)` | `rgba(248,113,113,0.10)` | Danger badge / alert backgrounds |
| `--app-neutral-sub` | `rgba(0,0,0,0.05)` | `rgba(255,255,255,0.05)` | Neutral badge / subtle backgrounds |
| `--app-text-1` | `#111827` | `#e8edf5` | Primary text — highest contrast |
| `--app-text-2` | `#4B5563` | `#8b95a9` | Secondary text — labels, descriptions |
| `--app-text-3` | `#9CA3AF` | `#576070` | Tertiary text — captions, placeholders |

**Pattern:** Every semantic color (`accent`, `success`, `warning`, `danger`) has three variants: full color for text/icons, `-sub` for backgrounds, `-border` (accent only) for tinted outlines.

---

## 4. Typography

| Role | Font | Size | Weight | Usage |
|------|------|------|--------|-------|
| Page title | IBM Plex Sans | 16 px | 600 | Topbar page name |
| Panel title | IBM Plex Sans | 14 px | 600 | PanelHeader title |
| Panel subtitle | IBM Plex Sans | 12.5 px | 400 | PanelHeader description |
| Nav label | IBM Plex Sans | 13.5 px | 500 | Sidebar nav item text |
| Body | IBM Plex Sans | 13.5 px | 400 | DataRow labels, general text |
| Secondary | IBM Plex Sans | 12.5 px | 400 | Helper text, secondary descriptions |
| Caption / label | IBM Plex Sans | 13 px | 500 | Form labels, button text |
| Section label | IBM Plex Sans | 11 px | 400 | Uppercase section headers |
| Mono value | IBM Plex Mono | 13 px | 500 | IPs, ports, timestamps, config values |
| Mono caption | IBM Plex Mono | 12.5 px | 500 | Topbar subtitle, small technical values |
| Tiny label | IBM Plex Sans | 11.5 px | 400 | Helper/error text under inputs |

**Rule:** IBM Plex Mono is reserved strictly for technical values — never for UI chrome, labels, or descriptions.

---

## 5. Components

### 5.0 PageContainer

Top-level wrapper for a page's content. Stacks child panels with a consistent vertical gap.

```jsx
import { PageContainer } from '@/components/ui/app-ui';

<PageContainer>
  <Panel>…</Panel>
  <Panel>…</Panel>
</PageContainer>
```

```css
.page-container { display: flex; flex-direction: column; gap: 16px; }
```

---

### 5.1 Panel / PanelHeader / PanelBody

Container for any data section. `PanelHeader` optionally takes a color-coded icon, title, subtitle, and right-side slot. `PanelBody` adds standard inner padding.

**Props**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `icon` | Lucide component | — | Optional icon (15 px) |
| `iconColor` | `'accent' \| 'success' \| 'warning' \| 'danger'` | `'accent'` | Icon container color scheme |
| `title` | string | — | Required heading |
| `subtitle` | string | — | Optional sub-heading |
| `right` | ReactNode | — | Slot for badge, button, etc. |

```jsx
// React / JSX
import { Panel, PanelHeader, PanelBody } from '@/components/ui/app-ui';
import { Wifi } from 'lucide-react';

<Panel>
  <PanelHeader
    icon={Wifi}
    iconColor="accent"
    title="Network Status"
    subtitle="Active interfaces"
    right={<StatusBadge variant="success" dot>Connected</StatusBadge>}
  />
  <PanelBody>
    {/* content */}
  </PanelBody>
</Panel>
```

```css
/* Plain CSS equivalent */
.panel {
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: 8px;
  overflow: hidden;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--app-border);
}
.panel-header-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 7px;
  flex-shrink: 0;
  background: var(--app-accent-sub);
  color: var(--app-accent-text);
}
.panel-header-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text-1);
  line-height: 1.2;
}
.panel-header-subtitle {
  font-size: 12.5px;
  color: var(--app-text-3);
  line-height: 1.2;
  margin-top: 2px;
}
.panel-body {
  padding: 16px 18px;
}
```

---

### 5.2 DataRow / MonoValue

Horizontal label-value pair. Stack them inside `PanelBody` for key-value layouts. `MonoValue` wraps any technical string in IBM Plex Mono.

**MonoValue props**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | ReactNode | — | The technical value to display |
| `color` | string (CSS color) | `var(--app-text-1)` | Override text color — use a `var(--app-*)` token |

```jsx
import { DataRow, MonoValue } from '@/components/ui/app-ui';

<DataRow label="IP Address">
  <MonoValue>192.168.1.100</MonoValue>
</DataRow>
<DataRow label="Gateway">
  <MonoValue>192.168.1.1</MonoValue>
</DataRow>
<DataRow label="Status" last>
  <StatusBadge variant="success" dot>Online</StatusBadge>
</DataRow>

{/* With color override */}
<DataRow label="Signal">
  <MonoValue color="var(--app-warning)">-72 dBm</MonoValue>
</DataRow>
```

```css
.data-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 0;
  border-bottom: 1px solid var(--app-border);
}
.data-row.last { border-bottom: none; }
.data-row-label {
  font-size: 13.5px;
  color: var(--app-text-2);
}
.mono-value {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 13px;
  font-weight: 500;
  color: var(--app-text-1); /* override via color prop */
}
```

---

### 5.3 StatusBadge

Inline pill for status labels. Combines a semantic `-sub` background with the matching text color.

**Variants:** `success` · `warning` · `danger` · `accent` · `neutral`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | see above | `'neutral'` | Color scheme |
| `dot` | boolean | `false` | Show 5 px color dot |

```jsx
import { StatusBadge } from '@/components/ui/app-ui';

<StatusBadge variant="success" dot>Running</StatusBadge>
<StatusBadge variant="warning">Degraded</StatusBadge>
<StatusBadge variant="danger" dot>Offline</StatusBadge>
<StatusBadge variant="accent">Active</StatusBadge>
<StatusBadge variant="neutral">Unknown</StatusBadge>
```

```css
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 5px;
  font-size: 12.5px;
  font-weight: 500;
}
.status-badge.success { background: var(--app-success-sub); color: var(--app-success); }
.status-badge.warning { background: var(--app-warning-sub); color: var(--app-warning); }
.status-badge.danger  { background: var(--app-danger-sub);  color: var(--app-danger); }
.status-badge.accent  { background: var(--app-accent-sub);  color: var(--app-accent-text); }
.status-badge.neutral { background: var(--app-neutral-sub); color: var(--app-text-2); }
.status-badge-dot {
  width: 5px; height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
  background: currentColor;
}
```

---

### 5.4 StatusDot

Compact active/inactive indicator with a check or X icon and a text label. Used inline in panels or topbar status pills.

```jsx
import { StatusDot } from '@/components/ui/app-ui';

<StatusDot active={true}  label="Running" />
<StatusDot active={false} label="Stopped" />
```

```css
/* Plain CSS — pair with a CheckCircle / XCircle SVG icon */
.status-dot-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13.5px;
  color: var(--app-text-1);
}
.status-dot-wrap .icon-active  { color: var(--app-success); }
.status-dot-wrap .icon-stopped { color: var(--app-danger); }
```

---

### 5.5 AppButton

Primary action button with four style variants.

| Variant | Background | Border | Text |
|---------|-----------|--------|------|
| `default` | `--app-accent` | `--app-accent` | white |
| `outline` | `--app-surface` | `--app-border-mid` | `--app-text-1` |
| `ghost` | transparent | transparent | `--app-text-2` |
| `destructive` | `--app-danger-sub` | `--app-danger` | `--app-danger` |

```jsx
import { AppButton } from '@/components/ui/app-ui';
import { Plus, Trash2 } from 'lucide-react';

<AppButton variant="default"><Plus size={14} /> Add Item</AppButton>
<AppButton variant="outline">Cancel</AppButton>
<AppButton variant="ghost">Settings</AppButton>
<AppButton variant="destructive" disabled><Trash2 size={14} /> Delete</AppButton>
```

```css
.app-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: opacity 130ms;
}
.app-btn:hover:not(:disabled) { opacity: 0.85; }
.app-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.app-btn.default     { background: var(--app-accent);     border-color: var(--app-accent);     color: #fff; }
.app-btn.outline     { background: var(--app-surface);    border-color: var(--app-border-mid); color: var(--app-text-1); }
.app-btn.ghost       { background: transparent;           border-color: transparent;           color: var(--app-text-2); }
.app-btn.destructive { background: var(--app-danger-sub); border-color: var(--app-danger);     color: var(--app-danger); }
```

---

### 5.6 IconBtn

Square 32×32 px icon-only button. Used in panel headers and action rows.

**Props**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'success' \| 'danger' \| 'warning'` | — | Semantic color for the button; omit for neutral grey |
| `disabled` | boolean | `false` | Disables click and fades to 50% opacity |
| `title` | string | — | Tooltip text (always provide for accessibility) |

```jsx
import { IconBtn } from '@/components/ui/app-ui';
import { Play, Square, RotateCcw, Trash2, RefreshCw } from 'lucide-react';

<IconBtn variant="success" title="Start" onClick={handleStart}><Play size={13} /></IconBtn>
<IconBtn variant="danger"  title="Stop"  onClick={handleStop}><Square size={13} /></IconBtn>
<IconBtn variant="warning" title="Restart" onClick={handleRestart}><RotateCcw size={13} /></IconBtn>
<IconBtn variant="danger"  title="Delete" onClick={handleDelete}><Trash2 size={13} /></IconBtn>
<IconBtn title="Refresh" onClick={handleRefresh}><RefreshCw size={14} /></IconBtn>
```

```css
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 130ms;
}
/* Default (neutral) */
.icon-btn          { background: var(--app-elevated); border: 1px solid var(--app-border);   color: var(--app-text-2); }
.icon-btn:hover    { background: var(--app-border); }
/* Semantic variants */
.icon-btn.success  { background: var(--app-success-sub); border: 1px solid var(--app-success); color: var(--app-success); }
.icon-btn.danger   { background: var(--app-danger-sub);  border: 1px solid var(--app-danger);  color: var(--app-danger); }
.icon-btn.warning  { background: var(--app-warning-sub); border: 1px solid var(--app-warning); color: var(--app-warning); }
/* Hover for semantic variants — slightly deeper sub-color */
.icon-btn.success:hover { background: rgba(52, 211, 153, 0.20); }
.icon-btn.danger:hover  { background: rgba(248, 113, 113, 0.20); }
.icon-btn.warning:hover { background: rgba(251, 191, 36, 0.20); }

.icon-btn:disabled { opacity: 0.5; cursor: not-allowed; }
```

---

### 5.7 Action Button Color Convention

Use semantic color variants on `IconBtn` (and `AppButton`) to communicate intent at a glance. This table is the canonical rule — follow it for any new action controls.

| Action | `IconBtn` variant | `AppButton` variant | Rationale |
|--------|-------------------|---------------------|-----------|
| Start / Enable / Install | `success` | `default` (accent) | Affirmative — green signals go |
| Stop / Disable | `danger` | `destructive` | Halts a running process |
| Delete / Uninstall | `danger` | `destructive` | Irreversible destructive action |
| Restart / Reload | `warning` | `outline` | Caution — causes a brief outage |
| Cancel scheduled action | `danger` | `outline` | Removes a scheduled future action |
| Neutral / Secondary | _(no variant)_ | `outline` / `ghost` | View, configure, navigate |

**Rule:** An `IconBtn` without a variant is neutral grey. Never use the accent color for destructive actions; never use `danger` for actions that are safe.

---

### 5.8 AppInput


Text input with optional label, error state, and helper text.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | string | — | Label above the input |
| `error` | boolean | `false` | Red border + ring |
| `helperText` | string | — | Message below; red when error |

```jsx
import { AppInput } from '@/components/ui/app-ui';

{/* Default */}
<AppInput label="Host" placeholder="192.168.1.1" value={host} onChange={e => setHost(e.target.value)} />

{/* Error state */}
<AppInput
  label="Port"
  type="number"
  error={!!portError}
  helperText={portError}
  value={port}
  onChange={e => setPort(e.target.value)}
/>
```

```css
.app-input-wrap { display: flex; flex-direction: column; gap: 4px; }

.app-input-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--app-text-1);
}
.app-input {
  padding: 8px 12px;
  border-radius: 8px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 13.5px;
  background: var(--app-elevated);
  border: 1px solid var(--app-border-mid);
  color: var(--app-text-1);
  outline: none;
  transition: border-color 130ms;
}
.app-input::placeholder { font-family: 'IBM Plex Sans', sans-serif; color: var(--app-text-3); }
.app-input:focus { border-color: var(--app-accent); }
.app-input.error { border-color: var(--app-danger); box-shadow: 0 0 0 1px var(--app-danger); }

.app-input-helper { font-size: 11.5px; color: var(--app-text-3); }
.app-input-helper.error { color: var(--app-danger); }
```

---

### 5.9 AppAlert

Inline alert banner for feedback messages. Always rendered inside the page content (no toast/snackbar).

**Severities:** `error` · `success` · `warning` · `info`

```jsx
import { AppAlert } from '@/components/ui/app-ui';

{errorMsg && <AppAlert severity="error">{errorMsg}</AppAlert>}
{saved    && <AppAlert severity="success">Configuration saved.</AppAlert>}
{warn     && <AppAlert severity="warning">Changes will take effect after restart.</AppAlert>}
{info     && <AppAlert severity="info">Device is syncing.</AppAlert>}
```

```css
.app-alert {
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 13.5px;
  font-weight: 500;
}
.app-alert.error   { background: var(--app-danger-sub);  color: var(--app-danger); }
.app-alert.success { background: var(--app-success-sub); color: var(--app-success); }
.app-alert.warning { background: var(--app-warning-sub); color: var(--app-warning); }
.app-alert.info    { background: var(--app-accent-sub);  color: var(--app-accent-text); }
```

---

### 5.10 SectionLabel / AppDivider

Structural separators for visual hierarchy inside panels.

```jsx
import { SectionLabel, AppDivider } from '@/components/ui/app-ui';

<SectionLabel>Connection Settings</SectionLabel>
<AppDivider />
```

```css
.section-label {
  font-size: 11px;
  font-weight: 400;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--app-text-3);
  margin-bottom: 10px;
}
.app-divider {
  border: none;
  border-top: 1px solid var(--app-border);
  margin: 4px 0;
}
```

---

### 5.11 Spinner / PageSpinner

Loading indicators. `Spinner` is inline; `PageSpinner` centers in a 256 px tall block — sized to fill a panel while data loads.

Both use `Loader2` from lucide-react with the `animate-spin` class (Tailwind).

```jsx
import { Spinner, PageSpinner } from '@/components/ui/app-ui';

{loading ? <PageSpinner /> : <DataTable />}
<AppButton onClick={save}>{saving ? <Spinner size={14} /> : 'Save'}</AppButton>
```

```jsx
// Implementation reference
import { Loader2 } from 'lucide-react';

function Spinner({ size = 20 }) {
  return <Loader2 size={size} className="animate-spin" style={{ color: 'var(--app-accent-text)' }} />;
}

function PageSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <Spinner size={28} />
    </div>
  );
}
```

---

## 6. Layout System

```
┌─────────────────────────────────────────────────────┐
│                    <html class="dark">              │
│  ┌────────────┬────────────────────────────────┐   │
│  │  Sidebar   │         Topbar (64 px)         │   │
│  │  62 px     ├────────────────────────────────┤   │
│  │ (256 px    │                                │   │
│  │  on hover) │     <main> page content        │   │
│  │            │     overflow-y: auto           │   │
│  └────────────┴────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### Shell CSS

```css
.app-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--app-bg);
}
.app-main-col {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.app-topbar {
  height: 64px;
  min-height: 64px;
  flex-shrink: 0;
  background: var(--app-surface);
  border-bottom: 1px solid var(--app-border);
}
.app-page {
  flex: 1;
  overflow-y: auto;
  padding: 22px 24px;
}
```

### Sidebar Dimensions & Behaviour

| Property | Value |
|----------|-------|
| Collapsed width | 62 px |
| Expanded width | 256 px (on hover) |
| Expand transition | `width 220ms ease-out` |
| Text reveal transition | `opacity 140ms`, 40 ms delay |
| Background | `var(--app-surface)` |
| Right border | `1px solid var(--app-border)` |
| Logo area height | 64 px |
| Nav item padding | 9 px vertical, 11 px horizontal |
| Nav icon size | 17 px |
| Active item | `--app-accent-sub` bg + 3 px left accent bar |
| Active text | `--app-accent-text` |
| Footer user avatar | 28 px circle, `--app-accent-sub` bg |

### React Layout JSX Skeleton

```jsx
// Layout.jsx
import Sidebar from './Sidebar';
import Topbar  from './Topbar';
import { createContext, useContext, useState, useCallback } from 'react';

const LayoutCtx = createContext({});
export const useLayout = () => useContext(LayoutCtx);

export default function Layout({ children }) {
  const [onRefresh, setOnRefresh] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const registerRefresh = useCallback((fn) => {
    setOnRefresh(() => fn);
  }, []);

  const handleRefresh = async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  };

  return (
    <LayoutCtx.Provider value={{ registerRefresh }}>
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--app-bg)' }}>
        <Sidebar />
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <Topbar onRefresh={onRefresh ? handleRefresh : null} refreshing={refreshing} />
          <main style={{ flex: 1, overflowY: 'auto', padding: '22px 24px' }}>
            {children}
          </main>
        </div>
      </div>
    </LayoutCtx.Provider>
  );
}

// In any page component — wire up the topbar refresh button:
const { registerRefresh } = useLayout();
useEffect(() => { registerRefresh(fetchAllData); }, [registerRefresh, fetchAllData]);
```

---

## 7. Spacing & Radius

### Border Radius

| Name | Value | Used for |
|------|-------|----------|
| `sm` | 4 px | Status dot, internal accents |
| `md` | 6 px | Small chips |
| `lg` | 8 px | Default — panels, buttons, inputs, dialogs, badges |
| `full` | 9999 px | Pills, avatar circles |

Panel icon containers use `7 px` (one step between md and lg).

### Padding Reference

| Component | Horizontal | Vertical |
|-----------|-----------|---------|
| PanelHeader | 18 px | 14 px |
| PanelBody | 18 px | 16 px |
| DataRow | 0 | 9 px |
| AppButton | 16 px | 8 px |
| AppInput | 12 px | 8 px |
| AppAlert | 16 px | 12 px |
| IconBtn | — | 32 × 32 px fixed |
| Topbar | 24 px | — |
| Sidebar nav item | 11 px | 9 px |
| Page content area | 24 px | 22 px |

---

## 8. Animation & Transitions

All interactive state transitions use **130 ms** — fast enough to feel instant, slow enough to be perceptible.

```css
/* Standard interactive transition */
transition: background-color 130ms, border-color 130ms, color 130ms, opacity 130ms;

/* Sidebar width expand/collapse */
transition: width 220ms ease-out;

/* Sidebar text/icon reveal on hover */
transition: opacity 140ms;
transition-delay: 40ms;

/* Spinner keyframe */
@keyframes spin { to { transform: rotate(360deg); } }
.animate-spin { animation: spin 0.7s linear infinite; }

/* Refresh icon while loading */
.animate-spin-slow { animation: spin 1.2s linear infinite; }
```

**No bounce, spring, or elastic easing** — this is a professional management tool, not a consumer app.

---

## 9. Icons

All icons from **[lucide-react](https://lucide.dev)**. Consistent sizes per context:

| Context | Size |
|---------|------|
| Sidebar nav | 17 px |
| PanelHeader icon (inside 30 px container) | 15 px |
| AppButton / inline | 14 px |
| StatusDot | 15 px |
| Topbar refresh | 14 px |
| Footer / small actions | 14 px |

**Icons in use across this app:**

```
LayoutDashboard, Wifi, Monitor, Puzzle, Upload, ShieldCheck   — sidebar nav
Sun, Moon, LogOut                                             — sidebar footer
RefreshCw, RotateCcw                                         — refresh actions
Shield, Clock, Power, ChevronDown, ChevronUp                 — remote management
Server, Router, Plus, Trash2                                 — data forwarding
Play, Square, Download, ScrollText, ExternalLink, Settings   — protocol apps
CheckCircle2, AlertCircle, XCircle, AlertTriangle            — status / alerts
Eye, EyeOff, User, Lock, Key, Github, KeyRound               — auth / setup
Wifi, Globe, Gauge, Network, KeyRound                        — network
Save, Edit2, X, Info, Search                                 — general CRUD
Loader2                                                      — spinner
```

Apply color with inline `style={{ color: 'var(--app-accent-text)' }}` — never via CSS class — so icon color respects the design token system.

---

## 10. Dark Mode

### Activation

Dark mode is class-based. Add `dark` to `<html>` to activate `.dark {}` CSS variable overrides.

```js
// Toggle
document.documentElement.classList.toggle('dark');

// Persist to localStorage
const saved = localStorage.getItem('theme');
if (saved === 'dark') document.documentElement.classList.add('dark');

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
}
```

### React ThemeContext pattern used in this app

```jsx
// ThemeContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
const Ctx = createContext({});
export const useAppTheme = () => useContext(Ctx);

export function ThemeProvider({ children }) {
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('theme') === 'dark');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  return (
    <Ctx.Provider value={{ darkMode, toggleDarkMode: () => setDarkMode(d => !d) }}>
      {children}
    </Ctx.Provider>
  );
}
```

### What changes between modes

Only CSS variable values change — no component logic branches, no class swaps in JSX. Every color reference uses `var(--app-*)` so all components automatically adapt.

---

## 11. Quick-Start Checklist

When building a new UI with this design system:

- [ ] Add Google Fonts `<link>` for IBM Plex Sans + Mono
- [ ] Copy the full `:root {}` and `.dark {}` CSS variable blocks
- [ ] Set `body { font-family: 'IBM Plex Sans', sans-serif; background: var(--app-bg); color: var(--app-text-1); }`
- [ ] Add dark mode toggle that sets/removes `dark` class on `<html>`
- [ ] Use `var(--app-surface)` for cards/panels, `var(--app-elevated)` for inputs/hover
- [ ] Use `var(--app-border)` for all 1 px borders; `var(--app-border-mid)` for inputs and outline buttons
- [ ] Keep `font-family: 'IBM Plex Mono'` only on technical values
- [ ] Set all transitions to `130ms`
- [ ] Use border-radius `8px` as default; never exceed it without a clear reason
