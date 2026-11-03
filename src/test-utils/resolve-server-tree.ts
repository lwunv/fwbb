import { isValidElement, type ReactElement, type ReactNode } from "react";

type AnyProps = { children?: ReactNode } & Record<string, unknown>;

function isAsyncComponent(
  type: unknown,
): type is (p: AnyProps) => Promise<ReactNode> {
  return (
    typeof type === "function" &&
    (type as { constructor: { name: string } }).constructor.name ===
      "AsyncFunction"
  );
}

/**
 * Expand a React tree the way the server would, without a renderer: async
 * server components are awaited (recursively), everything else is kept as an
 * element whose children are resolved. Synchronous function components (the
 * "use client" ones such as Header or the approval gates) are NOT called, so a
 * test can assert which component the layout chose and read its props.
 *
 * Why: lets layout-gate tests keep passing when layout logic moves into a
 * nested async server component, since both shapes resolve to the same tree.
 */
export async function resolveServerTree(node: ReactNode): Promise<ReactNode> {
  if (node === null || node === undefined || typeof node === "boolean") {
    return node;
  }
  if (Array.isArray(node)) {
    return Promise.all(node.map((child) => resolveServerTree(child)));
  }
  if (!isValidElement(node)) return node; // string | number | other

  const element = node as ReactElement<AnyProps>;
  if (isAsyncComponent(element.type)) {
    const out = await element.type(element.props);
    return resolveServerTree(out);
  }

  const { children } = element.props;
  if (children === undefined) return element;
  // Copy instead of mutating: React freezes elements in development.
  return {
    ...element,
    props: { ...element.props, children: await resolveServerTree(children) },
  } as ReactElement<AnyProps>;
}

function walk(
  node: ReactNode,
  visit: (el: ReactElement<AnyProps>) => boolean,
): ReactElement<AnyProps> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = walk(child, visit);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const element = node as ReactElement<AnyProps>;
  if (visit(element)) return element;
  return walk(element.props.children, visit);
}

/** First element of `type` (component function or host tag) in a resolved tree. */
export function findByType(
  tree: ReactNode,
  type: unknown,
): ReactElement<AnyProps> | null {
  return walk(tree, (el) => el.type === type);
}

/** True when any string/number leaf of a resolved tree equals `text`. */
export function hasText(tree: ReactNode, text: string): boolean {
  if (typeof tree === "string" || typeof tree === "number") {
    return String(tree) === text;
  }
  if (Array.isArray(tree)) return tree.some((child) => hasText(child, text));
  if (!isValidElement(tree)) return false;
  return hasText((tree as ReactElement<AnyProps>).props.children, text);
}
