function toCamelIdentifier(name: string): string {
  // If already camelCase (no separators), return as-is
  if (!/[/._-]/.test(name)) return name;
  const parts = name.split(/[/._-]+/).filter(Boolean);
  return parts
    .map((p, i) => (i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()))
    .join('');
}

export function renderCapabilityTs(name: string, withInput: boolean): string {
  const camel = toCamelIdentifier(name);

  if (!withInput) {
    return `import { capability } from '@capixjs/core';

export const ${camel} = capability(async (_input, _ctx) => {
  // TODO: implement
  return {};
});
`;
  }

  return `import { z } from 'zod';
import { capability } from '@capixjs/core';

const inputSchema = z.object({
  id: z.string(),
});

export const ${camel} = capability(inputSchema, async ({ id }, _ctx) => {
  // TODO: implement
  return { id };
});
`;
}

export function renderGroupTs(name: string, capabilities: string[]): string {
  const camel = toCamelIdentifier(name);
  const capImports = capabilities.map((c) => {
    const cc = toCamelIdentifier(c);
    return `import { ${cc} } from './${c}.js';`;
  });

  const capEntries = capabilities.map((c) => {
    const cc = toCamelIdentifier(c);
    return `  ${cc},`;
  });

  return `${capImports.join('\n')}

export const ${camel}Group = {
${capEntries.join('\n')}
};
`;
}
