const cleanInline = (value: string, maxLen: number) =>
  value.replace(/\s+/g, ' ').trim().slice(0, maxLen);

export const buildSummaryQuery = (
  url: string,
  title?: string,
  snippet?: string,
) => {
  const parts = [`Summary: ${url}`];

  const cleanTitle = cleanInline(title || '', 140);
  if (cleanTitle) {
    parts.push(`Title: ${cleanTitle}`);
  }

  const cleanSnippet = cleanInline(snippet || '', 360);
  if (cleanSnippet) {
    parts.push(`Snippet: ${cleanSnippet}`);
  }

  return parts.join('\n');
};

export const buildSummaryHref = (
  url: string,
  title?: string,
  snippet?: string,
) => {
  const q = buildSummaryQuery(url, title, snippet);
  return `/?${new URLSearchParams({ q }).toString()}`;
};
