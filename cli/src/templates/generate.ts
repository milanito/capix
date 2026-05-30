function toCamelIdentifier(name: string): string {
  // Split on any separator (/, ., -, _) and join as camelCase
  const parts = name.split(/[/._-]+/).filter(Boolean);
  return parts
    .map((p, i) => (i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()))
    .join('');
}

export function renderCapabilityTs(name: string, withInput: boolean): string {
  const camel = toCamelIdentifier(name);

  if (!withInput) {
    return `import { capability } from 'capix';

export const ${camel} = capability(() => {
  // TODO: implement
  return null;
});
`;
  }

  return `import { z } from 'zod';
import { capability } from 'capix';

const inputSchema = z.object({
  // TODO: define input fields
});

export const ${camel} = capability(inputSchema, async (input) => {
  // TODO: implement
  return null;
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
