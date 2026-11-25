// Holm's palette is derived from /home, not a second set of hand-maintained colors.
export function buildThemeTokens(homeCSS) {
  const root = homeCSS.match(/:root\s*\{([^}]+)\}/)?.[1];
  const light = homeCSS.match(/html\[data-theme="light"\]\s*\{([^}]+)\}/)?.[1];
  if (!root || !light) throw new Error('Cannot find the Workdeck home theme palettes');
  const declarations = block => [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)]
    .flatMap(([, key, value]) => {
      const rules = [`  --wd-ui-${key}: ${value};`];
      if (/^#[\da-f]{6}$/i.test(value)) {
        const rgb = value.slice(1).match(/../g).map(hex => parseInt(hex, 16)).join(' ');
        rules.push(`  --wd-ui-${key}-rgb: ${rgb};`);
      }
      return rules;
    }).join('\n');
  const value = (block, name) => block.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1];
  // Static utility ramp for Tailwind and Univer; each stop still comes from Home.
  const neutrals = {
    50:value(light, 'bg-elevated'), 100:value(light, 'bg-input'),
    200:value(light, 'border'), 300:value(light, 'border-strong'),
    400:value(root, 'text-secondary'), 500:value(root, 'text-tertiary'),
    600:value(light, 'text-secondary'), 700:value(root, 'border'),
    800:value(root, 'bg-elevated'), 900:value(light, 'text'), 950:value(root, 'bg'),
  };
  if (Object.values(neutrals).some(v => !v)) throw new Error('Incomplete Home neutral palette');
  const ramp = Object.entries(neutrals).map(([step, color]) => `--neutral-${step}: ${color};`).join('\n');
  return `/* Generated from public/workdeck.css. Do not edit the built copy. */
:root {
${declarations(root)}
${declarations(ramp)}
  color-scheme: dark;
}
:root[data-theme="light"] {
${declarations(light)}
  color-scheme: light;
}
/* Black on yellow is readable in both themes (white on light-theme yellow is not). */
:root {
  --wd-ui-on-accent: #0a0a0a;
  --wd-ui-focus: var(--wd-ui-accent);
  --wd-ui-focus-rgb: var(--wd-ui-accent-rgb);
}
:root[data-theme="light"] { --wd-ui-focus: #a16207; --wd-ui-focus-rgb: 161 98 7; }
`;
}

export function withSuiteTheme(page, app) {
  return page.replace(/<html\b/, `<html data-wd-app="${app}"`)
    .replace(/<head>/, '<head><script src="/js/suite-theme.js"></script>')
    .replace('</head>', '<link rel="stylesheet" href="/suite-tokens.css"><link rel="stylesheet" href="/suite-theme.css"></head>');
}
