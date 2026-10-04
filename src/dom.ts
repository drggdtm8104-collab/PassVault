// 画面部品の組み立て。値は必ず textContent / プロパティで入れ、innerHTML は使わない（XSS 対策）。

type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown> & {
  class?: string;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
};

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'on') {
        for (const [ev, fn] of Object.entries(v as Record<string, EventListener>)) el.addEventListener(ev, fn);
      } else if (k === 'class') {
        el.className = String(v);
      } else if (k.startsWith('aria-') || k.startsWith('data-') || k === 'role' || k === 'for' || k === 'autocorrect') {
        el.setAttribute(k, String(v));
      } else {
        (el as unknown as Record<string, unknown>)[k] = v;
      }
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function clear(el: Element): void {
  el.replaceChildren();
}
