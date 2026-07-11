/**
 * Render a JSON-LD <script> tag for structured data. Every "<" in the
 * serialized JSON is unicode-escaped so a stray "</script>" inside the data
 * cannot break out of the tag.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  // JSON-LD requires raw HTML; "<" is escaped above so "</script>" can't break out.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
