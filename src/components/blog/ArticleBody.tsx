import type { ReactNode } from "react";
import type { BlogBlock, BlogSection } from "@/src/data/blog-posts";

/* Renders a blog article's intro + section blocks as semantic HTML. Hook-free and
   free of server-only imports, so it works in both the public SSR article page and
   the client-side super-admin draft preview. Text is authored in-repo (static file)
   or model-generated then validated, so the tiny **bold** inline pass is trusted. */

function renderInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="fp-text font-semibold">{part.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function Block({ block }: { block: BlogBlock }) {
  switch (block.kind) {
    case "p":
      return <p className="fp-text-dim text-[15px] leading-[1.75] mb-5">{renderInline(block.text)}</p>;
    case "h3":
      return <h3 className="fp-display text-xl mt-8 mb-3">{block.text}</h3>;
    case "ul":
      return (
        <ul className="list-disc pl-5 space-y-2 mb-5 fp-text-dim text-[15px] leading-[1.7]">
          {block.items.map((it, i) => <li key={i}>{renderInline(it)}</li>)}
        </ul>
      );
    case "ol":
      return (
        <ol className="list-decimal pl-5 space-y-2 mb-5 fp-text-dim text-[15px] leading-[1.7]">
          {block.items.map((it, i) => <li key={i}>{renderInline(it)}</li>)}
        </ol>
      );
    case "quote":
      return (
        <blockquote className="border-l-2 fp-gold-border pl-4 my-6 fp-text italic text-[15px] leading-[1.7]">
          {renderInline(block.text)}
        </blockquote>
      );
  }
}

export function ArticleBody({ intro, sections }: { intro: string; sections: BlogSection[] }) {
  return (
    <>
      <p className="fp-text text-lg leading-[1.7] mb-10 pb-10 border-b fp-line-soft">{renderInline(intro)}</p>
      {sections.map((section, si) => (
        <section key={si} className="mb-10">
          <h2 className="fp-display text-2xl mb-4">{section.h2}</h2>
          {section.blocks.map((block, i) => <Block key={i} block={block} />)}
        </section>
      ))}
    </>
  );
}
