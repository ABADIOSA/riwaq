/**
 * React's JSX runtime with the interface language applied (core/i18n.mjs).
 * Every host element (a <div>, a <button>, never a component) has its text
 * children and its readable labels translated as it renders, so constants,
 * labels from core/ and notices from main read in the viewer's language
 * without each string being wrapped by hand.
 */
import {
  Fragment,
  jsx as reactJsx,
  jsxs as reactJsxs,
} from "react/jsx-runtime";
import { language, translate } from "../../core/i18n.mjs";

const LABELS = ["title", "placeholder", "aria-label", "alt", "label"];

function translated(children) {
  if (typeof children === "string") return translate(children);
  if (!Array.isArray(children)) return children;
  let changed = false;
  const out = children.map((child) => {
    if (typeof child !== "string") return child;
    const next = translate(child);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? out : children;
}

export function localize(type, props) {
  if (typeof type !== "string" || !props || language() === "ar") return props;
  // translate="no" keeps an element as written (a language's own name).
  if (props.translate === "no") return props;
  let next = props;
  const children = translated(props.children);
  if (children !== props.children) next = { ...props, children };
  for (const name of LABELS) {
    const value = props[name];
    if (typeof value !== "string") continue;
    const text = translate(value);
    if (text === value) continue;
    if (next === props) next = { ...props };
    next[name] = text;
  }
  return next;
}

export { Fragment };
export const jsx = (type, props, key) =>
  reactJsx(type, localize(type, props), key);
export const jsxs = (type, props, key) =>
  reactJsxs(type, localize(type, props), key);
