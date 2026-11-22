// MDX components for content/docs: Fumadocs' defaults (code blocks, callouts,
// cards, tables, heading anchors).
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';

export function getMDXComponents(components?: MDXComponents) {
  return { ...defaultMdxComponents, ...components } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;
