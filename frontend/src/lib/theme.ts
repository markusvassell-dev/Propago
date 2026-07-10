// Design tokens (DESIGN_SPEC §1.1 / §1.2) — the EXACT values from the
// prototype's THEMES object. Applied as CSS custom properties on <html>.
// The sidebar/toast never theme (§3.1/§3.4) — their hexes live in components.

export const THEMES = {
  light: {
    bg: '#f4f2ed', bg2: '#fbfaf6', card: '#ffffff', bg3: '#f8f6f0', bg4: '#f7f5ef', bg5: '#f1efe7',
    line: '#e7e4da', line2: '#f0ede4', line3: '#ece9df', line4: '#e4e1d7', line5: '#d8d4c8', line6: '#c9c4b4',
    seg: '#e4e0d3', dot: '#d9d5c7', skip: '#c6c1b2',
    tx: '#1a1d20', tx1: '#3a3e44', tx2: '#5c6470', tx3: '#8a8578', tx4: '#bdb8a9',
    grn: '#137a5b', grnH: '#0e5f47', amb: '#b45309', ambH: '#d97706', amb2: '#a16207',
    vio: '#5b4fc2', red: '#b3261e', redH: '#8e1b15', cyn: '#0e7490',
    redT: '#faf1f0', redL: '#e4c7c5'
  },
  dark: {
    bg: '#101214', bg2: '#16191d', card: '#1b2025', bg3: '#22262c', bg4: '#15181c', bg5: '#262b32',
    line: '#2b3038', line2: '#262b32', line3: '#2b3038', line4: '#303640', line5: '#3c434d', line6: '#4a515b',
    seg: '#333941', dot: '#3f464f', skip: '#4c535c',
    tx: '#e8e6e1', tx1: '#c6c4be', tx2: '#9aa0aa', tx3: '#7c828e', tx4: '#575d67',
    grn: '#1f9d76', grnH: '#27b489', amb: '#e0913c', ambH: '#eca84f', amb2: '#cfa14a',
    vio: '#9187ea', red: '#e0625a', redH: '#eb7a72', cyn: '#38b2d2',
    redT: 'rgba(224,98,90,.12)', redL: '#5c3936'
  }
} as const;

export function applyTheme(dark: boolean): void {
  const t = dark ? THEMES.dark : THEMES.light;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t)) root.style.setProperty(`--${k}`, v);
  root.style.colorScheme = dark ? 'dark' : 'light';
}

export function savedTheme(): boolean {
  try {
    return localStorage.getItem('nf-theme') === 'dark';
  } catch {
    return false;
  }
}

export function persistTheme(dark: boolean): void {
  try {
    localStorage.setItem('nf-theme', dark ? 'dark' : 'light');
  } catch {
    /* ignore */
  }
}
