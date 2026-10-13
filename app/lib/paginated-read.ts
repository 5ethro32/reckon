// Flat, ordered pages avoid both the API row limit and nested-line truncation.
export async function readAll<T extends { id: string }>(fetchPage: (after: string | null) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  let after: string | null = null;
  for (;;) {
    const result = await fetchPage(after);
    if (result.error) throw new Error(result.error.message);
    const page = result.data ?? [];
    if (!page.length) return rows;
    const next = page[page.length - 1].id;
    if (next === after) throw new Error('Report pagination did not advance.');
    rows.push(...page); after = next;
  }
}
