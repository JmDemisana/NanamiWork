import { describe, expect, test } from "bun:test";
import { createStreamingMarkdownRenderer, renderMarkdownHtml, renderHighlightedMarkdownHtml } from "../src/components/markdown/markdown-primitive";

const array = String.raw`$$\begin{array}{c|cc}
s^2 & 1 & 8K_p \\
s^1 & 6 + 8K_d & 0 \\
s^0 & 8K_p & 0
\end{array}$$`;

describe("math rendering", () => {
  test("renders a multiline dollar-delimited array with attached delimiters", () => {
    const html = renderMarkdownHtml("Routh Array:\n" + array, "chat");
    expect(html).toContain("katex-display");
    expect(html).toContain("<mtable");
    expect(html).not.toContain("$$");
  });

  test("keeps fenced and inline code and ordinary prices literal", () => {
    const text = "Price: $5 and $10.\n\nInline `$$x$$` stays literal.\n\n```latex\n$$x$$\n```";
    const html = renderMarkdownHtml(text, "chat");
    expect(html).toContain("$5 and $10");
    expect(html).not.toContain("katex-display");
    expect(html).toContain("$$");
  });

  test("renders the same formula after code highlighting", async () => {
    const html = await renderHighlightedMarkdownHtml(array + "\n\n`code`", "chat");
    expect(html).toContain("katex-display");
    expect(html).toContain("<mtable");
  });

  test("reparses an array as it streams in", () => {
    const renderer = createStreamingMarkdownRenderer("chat");
    const intro = "Intro\n\nAnother paragraph\n\nRouth Array:\n";
    renderer.render(intro + array.slice(0, 28));
    const html = renderer.render(intro + array).map((block) => block.__html).join("");
    expect(html).toContain("katex-display");
    expect(html).toContain("<mtable");
  });

  test("keeps Markdown emphasis and renders math text emphasis", () => {
    const html = renderMarkdownHtml(String.raw`**bold** and *italic*, then $\textbf{bold} + \mathit{italic}$`, "chat");
    expect(html).toContain("<strong>");
    expect(html).toContain("<em>");
    expect(html).toContain("class=\"katex\"");
    expect(html).toContain("bold");
    expect(html).toContain("italic");
  });

  test("streaming keeps a growing display block together across blank lines", () => {
    const renderer = createStreamingMarkdownRenderer("chat");
    const intro = "One\n\nTwo\n\nThree\n\n";
    const partial = String.raw`$$
\begin{aligned}
a &= 1 \\

b &= 2 \\

c &= 3
`;
    const ending = String.raw`\end{aligned}
$$`;
    renderer.render(intro + partial);
    const streamed = renderer.render(intro + partial + ending).map((block) => block.__html).join("");
    expect(streamed).toContain("katex-display");
    expect(streamed).toBe(renderMarkdownHtml(intro + partial + ending, "chat"));
  });

  test("preserves existing inline and display math delimiters", () => {
    const slash = String.fromCharCode(92);
    const source = ["Inline $x^2$ and " + slash + "(y^2" + slash + ").", "$$\nz=1\n$$", slash + "[w=2" + slash + "]"].join("\n\n");
    const html = renderMarkdownHtml(source, "chat");
    expect((html.match(/class="katex"/g) ?? []).length).toBe(4);
    expect((html.match(/katex-display/g) ?? []).length).toBe(2);
  });

  test("unclosed math remains readable", () => {
    const html = renderMarkdownHtml("Not finished: $$x + y", "chat");
    expect(html).toContain("$$x + y");
  });

  test("renders math beside bold and italic labels without consuming the formatting", () => {
    const html = renderMarkdownHtml("**Given:** $x^2$ and *result:* $y$.", "chat");
    expect(html).toContain("<strong>");
    expect(html).toContain("<em>");
    expect((html.match(/class="katex"/g) ?? []).length).toBe(2);
  });

});
