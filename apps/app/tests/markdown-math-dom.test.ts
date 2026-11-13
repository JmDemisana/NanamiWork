import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, expect, test } from "bun:test";

GlobalRegistrator.register({ url: "http://localhost:5173/" });
const { renderMarkdownHtml } = await import("../src/components/markdown/markdown-primitive");
afterAll(async () => { await GlobalRegistrator.unregister(); });

test("sanitized chat math retains its visible and accessible array", () => {
  const formula = String.raw`$$\begin{array}{cc}
a & b \\
c & d
\end{array}$$`;
  const root = document.createElement("div");
  const output = renderMarkdownHtml(formula, "chat");
  root.innerHTML = output;
  expect(root.querySelector(".katex-html")).not.toBeNull();
  expect(root.querySelectorAll(".katex-mathml mtable mtr")).toHaveLength(2);
  expect(root.querySelector(".katex-mathml annotation")?.textContent).toContain("begin{array}");
});
