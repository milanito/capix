export function renderCapabilityTs(name: string, withInput: boolean): string {
  const camel = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

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
  const camel = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  const capImports = capabilities.map((c) => {
    const cc = c.replace(/-([a-z])/g, (_: string, ch: string) => ch.toUpperCase());
    return `import { ${cc} } from './${c}.js';`;
  });

  const capEntries = capabilities.map((c) => {
    const cc = c.replace(/-([a-z])/g, (_: string, ch: string) => ch.toUpperCase());
    return `  ${cc},`;
  });

  return `${capImports.join('\n')}

export const ${camel}Group = {
${capEntries.join('\n')}
};
`;
}
