import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type {
  RulebookFormat, StudioKnowledgeDocSummary, StudioObservationPattern, StudioRagMetrics,
} from "@kelana-ria/contracts";
import { maxStudioDocumentChars } from "./studio-document-parser.js";
import { redactStudioKnowledge } from "./studio-knowledge-privacy.js";

type PlatformSnippet = {
  id: string;
  format: RulebookFormat | "all";
  topic: "schema" | "pattern" | "category" | "validator" | "safety";
  primitive?: string;
  pattern?: StudioObservationPattern;
  category?: string;
  title: string;
  body: string;
};

type GuideChunk = { title: string; body: string };
export type StudioRagSnippet = GuideChunk & { id: string; namespace: "platform" | "creator_doc"; docId?: string };
export type StudioDraftScope = { ownerHash: string; packId: string; version: number };
export type StudioRagQuery = {
  ownerHash: string;
  packId?: string;
  version?: number;
  docIds?: readonly string[];
  query: string;
  format: RulebookFormat;
  primitive?: string;
  pattern?: StudioObservationPattern;
  category?: string;
  maxChars?: number;
  privateValues?: readonly string[];
};

export type StudioRagReranker = (query: string, candidates: readonly StudioRagSnippet[]) => readonly string[];

const maxDocuments = 5;
const chunkSize = 400;
const overlap = 60;
const defaultBudget = 8_000;
const corpus = readFileSync(new URL("../data/studio-rag-knowledge.json", import.meta.url), "utf8");
const knowledge = JSON.parse(corpus) as { version: number; snippets: PlatformSnippet[] };
const corpusHash = createHash("sha256").update(corpus).digest("hex");
const platformChars = knowledge.snippets.map(excerpt).join("\n\n").length;

function excerpt(chunk: GuideChunk) {
  return chunk.title + "\n" + chunk.body;
}

function scopeArgs(scope: StudioDraftScope) {
  return [scope.ownerHash, scope.packId, scope.version] as const;
}

function headingOf(line: string, standalone: boolean) {
  const markdown = /^#{1,6}[ \t]+(.+?)\s*#*$/.exec(line)?.[1];
  if (markdown) return markdown.trim();
  if (line.length > 85 || /[.!?;]$/.test(line)) return undefined;
  const stop = /^(?:\d{1,2}[.)]|(?:stop|titik|pemberhentian)\s+\d{1,2}[:.\-]?)\s+(.+)$/i.exec(line)?.[1];
  if (stop) return stop.trim();
  if (standalone && /^\p{Lu}[\p{L}\d &,'’–-]*:?$/u.test(line) && line.split(/\s+/).length <= 9) {
    return line.replace(/:$/, "");
  }
  return undefined;
}

export function chunkStudioGuide(text: string, title: string): GuideChunk[] {
  const chunks: GuideChunk[] = [];
  const lines = text.split("\n");
  const breadcrumbs: string[] = [];
  let heading = title;
  let content: string[] = [];

  function flush() {
    const body = content.join("\n").trim();
    for (let start = 0; start < body.length;) {
      const end = Math.min(start + chunkSize, body.length);
      const window = body.slice(start, end);
      const lastBreak = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
      const boundary = end < body.length && lastBreak > chunkSize * 0.7 ? start + lastBreak : end;
      chunks.push({ title: heading, body: body.slice(start, boundary).trim() });
      if (boundary === body.length) break;
      const next = boundary - overlap;
      const space = body.slice(next, boundary).search(/\s/);
      start = space >= 0 ? next + space + 1 : next;
    }
    content = [];
  }

  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    const newHeading = headingOf(line, !lines[index - 1]?.trim());
    if (!newHeading) {
      content.push(line);
      continue;
    }
    if (!content.some(Boolean) && heading !== title) content.push(heading);
    flush();
    const depth = /^#{1,6}\s/.exec(line)?.[0].trim().length ?? 1;
    breadcrumbs.splice(depth - 1);
    breadcrumbs.push(newHeading);
    heading = breadcrumbs.join(" › ").slice(-160);
  }
  if (!content.some(Boolean) && heading !== title) content.push(heading);
  flush();
  return chunks;
}

function ftsTerms(text: string) {
  const terms = [...new Set(text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]{2,32}/gu) ?? [])];
  return terms.slice(0, 24).map(term => '"' + term + '"').join(" OR ");
}

type DocRow = {
  doc_id: string; title: string; chunk_count: number; total_chars: number; headings: string; created_at: number;
};
type ChunkRow = { rowid: number; title: string; body: string; doc_id: string; document_title: string };
type RankedPlatformId = { id: string };
type DocResult =
  | { ok: true; doc: StudioKnowledgeDocSummary }
  | { ok: false; error: "document-limit" | "document-too-large" | "invalid-document" };

function summary(row: DocRow): StudioKnowledgeDocSummary {
  return {
    docId: row.doc_id, title: row.title, chunkCount: row.chunk_count, totalChars: row.total_chars,
    previewHeadings: JSON.parse(row.headings) as string[], createdAt: new Date(row.created_at).toISOString(),
  };
}

export function createStudioRagStore(db: DatabaseSync, rerank?: StudioRagReranker) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS studio_platform_revision (id INTEGER PRIMARY KEY CHECK (id = 1), hash TEXT NOT NULL);
    CREATE VIRTUAL TABLE IF NOT EXISTS studio_platform_fts USING fts5(
      id UNINDEXED, title, body, tokenize='unicode61 remove_diacritics 2'
    );
    CREATE TABLE IF NOT EXISTS studio_guide_docs (
      doc_id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, pack_id TEXT NOT NULL, version INTEGER NOT NULL,
      content_hash TEXT NOT NULL, title TEXT NOT NULL, chunk_count INTEGER NOT NULL, total_chars INTEGER NOT NULL,
      headings TEXT NOT NULL, created_at INTEGER NOT NULL,
      UNIQUE (owner_hash, pack_id, version, content_hash)
    );
    CREATE TABLE IF NOT EXISTS studio_guide_chunks (
      id INTEGER PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES studio_guide_docs(doc_id) ON DELETE CASCADE,
      title TEXT NOT NULL, body TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS studio_guide_chunk_doc ON studio_guide_chunks(doc_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS studio_guide_fts USING fts5(
      title, body, content='studio_guide_chunks', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER IF NOT EXISTS studio_guide_index_put AFTER INSERT ON studio_guide_chunks BEGIN
      INSERT INTO studio_guide_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
    END;
    CREATE TRIGGER IF NOT EXISTS studio_guide_index_remove AFTER DELETE ON studio_guide_chunks BEGIN
      INSERT INTO studio_guide_fts(studio_guide_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
    END;
    INSERT INTO studio_guide_fts(studio_guide_fts, rank) VALUES ('secure-delete', 1);
  `);

  function atomic<T>(action: () => T): T {
    if (db.isTransaction) return action();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  const revision = db.prepare("SELECT hash FROM studio_platform_revision WHERE id = 1");
  if (revision.get()?.hash !== corpusHash) {
    atomic(() => {
      db.exec("DELETE FROM studio_platform_fts");
      const insert = db.prepare("INSERT INTO studio_platform_fts(id, title, body) VALUES (?, ?, ?)");
      for (const item of knowledge.snippets) insert.run(item.id, item.title, item.body);
      db.prepare("INSERT OR REPLACE INTO studio_platform_revision VALUES (1, ?)").run(corpusHash);
    });
  }
  const searchPlatform = db.prepare(`
    SELECT id FROM studio_platform_fts WHERE studio_platform_fts MATCH ? ORDER BY bm25(studio_platform_fts, 0, 2, 1), rowid
  `);
  const listDocs = db.prepare(`
    SELECT * FROM studio_guide_docs WHERE owner_hash = ? AND pack_id = ? AND version = ? ORDER BY created_at, doc_id
  `);
  const putDoc = db.prepare("INSERT INTO studio_guide_docs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const putChunk = db.prepare("INSERT INTO studio_guide_chunks(doc_id, title, body) VALUES (?, ?, ?)");
  const deleteDoc = db.prepare("DELETE FROM studio_guide_docs WHERE owner_hash = ? AND doc_id = ?");
  const deleteDraftDocs = db.prepare("DELETE FROM studio_guide_docs WHERE owner_hash = ? AND pack_id = ? AND version = ?");
  const scopedChunks = `
    FROM studio_guide_docs d
    JOIN studio_guide_chunks c ON c.doc_id = d.doc_id
    WHERE d.owner_hash = ? AND d.pack_id = ? AND d.version = ?
      AND (? IS NULL OR d.doc_id IN (SELECT value FROM json_each(?)))
  `;
  const selectChunks = "SELECT c.id AS rowid, c.doc_id, c.title, c.body, d.title AS document_title";
  const fallbackDocs = db.prepare(selectChunks + scopedChunks + " ORDER BY c.id");
  const firstDocChunks = db.prepare(
    selectChunks + scopedChunks + " ORDER BY ROW_NUMBER() OVER (PARTITION BY d.doc_id, c.title ORDER BY c.id), c.id LIMIT 24",
  );
  const docChars = db.prepare(`
    SELECT COALESCE(SUM(total_chars), 0) AS size FROM studio_guide_docs
    WHERE owner_hash = ? AND pack_id = ? AND version = ?
      AND (? IS NULL OR doc_id IN (SELECT value FROM json_each(?)))
  `);
  const searchDocs = db.prepare(
    selectChunks + " FROM studio_guide_fts JOIN studio_guide_chunks c ON c.id = studio_guide_fts.rowid " +
    "JOIN studio_guide_docs d ON c.doc_id = d.doc_id " +
    "WHERE d.owner_hash = ? AND d.pack_id = ? AND d.version = ? " +
    "AND (? IS NULL OR d.doc_id IN (SELECT value FROM json_each(?))) AND studio_guide_fts MATCH ? " +
    "ORDER BY bm25(studio_guide_fts, 2, 1), c.id LIMIT 24",
  );

  function ingestStudioDoc(scope: StudioDraftScope, input: { title: string; text: string; now: number; privateValues?: readonly string[] }): DocResult {
    if (input.text.length > maxStudioDocumentChars) return { ok: false, error: "document-too-large" };
    const title = redactStudioKnowledge(input.title, input.privateValues).replace(/\s+/g, " ").slice(0, 120);
    const text = redactStudioKnowledge(input.text, input.privateValues);
    if (text.length > maxStudioDocumentChars) return { ok: false, error: "document-too-large" };
    if (!title || !text) return { ok: false, error: "invalid-document" };
    const hash = createHash("sha256").update(text).digest("hex");
    return atomic(() => {
      const existing = listDocs.all(...scopeArgs(scope)) as (DocRow & { content_hash: string })[];
      const duplicate = existing.find(doc => doc.content_hash === hash);
      if (duplicate) return { ok: true, doc: summary(duplicate) };
      if (existing.length >= maxDocuments) return { ok: false, error: "document-limit" };
      const chunks = chunkStudioGuide(text, title);
      const headings = [...new Set(chunks.map(chunk => chunk.title))].slice(0, 8);
      const docId = randomUUID();
      const row: DocRow = {
        doc_id: docId, title, chunk_count: chunks.length, total_chars: text.length,
        headings: JSON.stringify(headings), created_at: input.now,
      };
      putDoc.run(docId, ...scopeArgs(scope), hash, title, row.chunk_count, row.total_chars, row.headings, row.created_at);
      for (const chunk of chunks) putChunk.run(docId, chunk.title, chunk.body);
      return { ok: true, doc: summary(row) };
    });
  }

  function docArgs({ docIds, ...scope }: StudioDraftScope & { docIds?: readonly string[] }) {
    const ids = docIds ? JSON.stringify([...new Set(docIds)].slice(0, maxDocuments)) : null;
    return [...scopeArgs(scope), ids, ids] as const;
  }

  function readStudioDocChunks(scope: StudioDraftScope, docIds?: readonly string[]) {
    return fallbackDocs.all(...docArgs({ ...scope, docIds })) as ChunkRow[];
  }

  function retrieveStudioContext(input: StudioRagQuery) {
    const budget = Number.isFinite(input.maxChars) ? Math.max(0, Math.floor(input.maxChars!)) : defaultBudget;
    const query = redactStudioKnowledge(input.query.slice(0, 2400), input.privateValues);
    const terms = ftsTerms(query);
    const rank = new Map((terms ? searchPlatform.all(terms) as RankedPlatformId[] : []).map((row, i) => [row.id, i]));
    const rankOf = (item: PlatformSnippet) => rank.get(item.id) ?? Number.MAX_SAFE_INTEGER;
    const applicable = knowledge.snippets.filter(item =>
      (item.format === "all" || item.format === input.format) &&
      (!input.primitive || !item.primitive || item.primitive === input.primitive) &&
      (!item.pattern || item.pattern === input.pattern || !input.primitive && rank.has(item.id)) &&
      (!item.category || item.category === input.category || !input.primitive && rank.has(item.id)));
    const schemas = applicable.filter(item => item.topic === "schema");
    const chosen = [
      ...schemas.sort((a, b) => rankOf(a) - rankOf(b)).slice(0, input.primitive ? 1 : 3),
      ...applicable.filter(item => item.topic === "validator" || item.topic === "safety"),
      ...applicable.filter(item => item.topic === "pattern" || item.topic === "category").sort((a, b) => rankOf(a) - rankOf(b)).slice(0, 3),
    ];
    const hasScope = input.packId !== undefined && input.version !== undefined;
    const args = hasScope ? docArgs({ ownerHash: input.ownerHash, packId: input.packId!, version: input.version!, docIds: input.docIds }) : undefined;
    const matches = terms && args ? searchDocs.all(...args, terms) as ChunkRow[] : [];
    const candidates = matches.length ? matches : args ? firstDocChunks.all(...args) as ChunkRow[] : [];
    const docSnippets = candidates.map((row): StudioRagSnippet => ({
      namespace: "creator_doc", id: String(row.rowid), docId: row.doc_id,
      title: redactStudioKnowledge(row.title, input.privateValues),
      body: redactStudioKnowledge(row.body, input.privateValues),
    })).filter(item => Boolean(item.body));
    if (rerank && docSnippets.length > 1) {
      try {
        const positions = new Map(rerank(query, docSnippets).map((id, index) => [id, index]));
        docSnippets.sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity));
      } catch {
        // FTS5 remains the default when a configured local reranker fails.
      }
    }

    const snippets: StudioRagSnippet[] = [];
    let injectedChars = 0;
    let budgetCapped = false;
    for (const snippet of [
      ...chosen.map(({ id, title, body }): StudioRagSnippet => ({ id, title, body, namespace: "platform" })),
      ...docSnippets,
    ]) {
      const size = excerpt(snippet).length + (snippets.length ? 2 : 0);
      if (injectedChars + size > budget) {
        budgetCapped = true;
        continue;
      }
      injectedChars += size;
      snippets.push(snippet);
    }
    const platformChunks = snippets.filter(item => item.namespace === "platform").length;
    const sourceChars = platformChars + Number(args ? docChars.get(...args)?.size : 0);
    const ragMetrics: StudioRagMetrics = {
      retrievedChunks: snippets.length, platformChunks, docChunks: snippets.length - platformChunks,
      sourceChars, injectedChars, estimatedTokensSaved: Math.max(0, Math.floor((sourceChars - injectedChars) / 4)), budgetCapped,
    };
    return {
      snippets, ragMetrics,
      platformContext: snippets.filter(item => item.namespace === "platform").map(excerpt).join("\n\n"),
      guideContext: snippets.filter(item => item.namespace === "creator_doc").map(excerpt).join("\n\n"),
    };
  }

  return {
    ingestStudioDoc, readStudioDocChunks, retrieveStudioContext,
    listStudioDocs: (scope: StudioDraftScope) => (listDocs.all(...scopeArgs(scope)) as DocRow[]).map(summary),
    deleteStudioDoc: (ownerHash: string, docId: string) => Number(deleteDoc.run(ownerHash, docId).changes) > 0,
    clearStudioDocs: (scope: StudioDraftScope) => { deleteDraftDocs.run(...scopeArgs(scope)); },
  };
}
