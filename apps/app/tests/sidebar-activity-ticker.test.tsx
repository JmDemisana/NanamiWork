import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionDotMatrixLoader } from "../src/react-app/domains/session/sidebar/session-dot-matrix-loader";

test("sidebar activity uses the startup ticker and exposes its status", () => {
  const markup = renderToStaticMarkup(createElement(SessionDotMatrixLoader, { label: "Working" }));
  expect(markup).toContain('role="status"');
  expect(markup).toContain('aria-label="Working"');
  expect(markup.match(/class="ow-dot-ticker rounded-full"/g)).toHaveLength(9);
  expect(markup).not.toContain("ow-dot-matrix-frame-");
});
