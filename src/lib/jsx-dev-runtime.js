/** The development build's JSX runtime, with the same translation. */
import { Fragment, jsxDEV as reactJsxDEV } from "react/jsx-dev-runtime";
import { localize } from "./jsx-runtime.js";

export { Fragment };
export const jsxDEV = (type, props, key, isStatic, source, self) =>
  reactJsxDEV(type, localize(type, props), key, isStatic, source, self);
