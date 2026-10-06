<?php

declare(strict_types=1);

namespace StudyApp;

/**
 * Study items: drafts in the review queue and approved knowledge in the library.
 *
 * Status flow: pending -> approved | discarded | merged. Only approved items are
 * studied, searched or summarised.
 */
final class Items
{
    /** Leitner box -> days until the card is due again. */
    private const BOX_DAYS = [0 => 0, 1 => 0, 2 => 1, 3 => 3, 4 => 7, 5 => 16];

    /** Fields the learner can edit. Tags are excluded from "edited" (tagging is not rewriting). */
    private const CONTENT_FIELDS = ['kind', 'title', 'statement', 'interpretation', 'card_front', 'card_back', 'steps'];

    /**
     * Grounds one generated draft in its source and stores it as pending.
     *
     * @param array<string, mixed> $source
     * @param array<string, mixed> $draft
     *
     * @return int|null new item id, or null when the draft is empty or a duplicate
     */
    public static function createDraft(array $source, array $draft, string $origin): ?int
    {
        $fields = self::clean($draft);
        if ($fields['title'] === '' || ($fields['statement'] === '' && $fields['card_back'] === '' && $fields['kind'] !== 'question')) {
            return null;
        }
        $title = Text::normalize($fields['title']);
        foreach (Db::all('SELECT title FROM items WHERE source_id = ? AND kind = ?', [$source['id'], $fields['kind']]) as $existing) {
            if (Text::normalize($existing['title']) === $title) {
                return null;
            }
        }

        $quote = trim((string) ($draft['excerpt'] ?? ''));
        $found = $quote !== '' ? Text::locate($source['content'], $quote) : null;

        $now = now_iso();
        $id = Db::insert('items', self::encode($fields) + [
            'source_id' => $source['id'],
            'status' => 'pending',
            'origin' => $origin,
            'model' => (string) ($draft['model'] ?? ''),
            'draft' => json_encode($fields, JSON_UNESCAPED_UNICODE),
            'created_at' => $now,
        ]);
        Db::insert('excerpts', [
            'item_id' => $id,
            'source_id' => $source['id'],
            'text' => $found['text'] ?? $quote,
            'quoted' => $quote,
            'start' => $found['start'] ?? null,
            'length' => $found['length'] ?? null,
            'match' => $found['match'] ?? 'missing',
        ]);
        return $id;
    }

    /**
     * A card the learner writes themselves from a passage they selected in a source.
     * It goes straight to the library: the person writing it is the reviewer.
     *
     * @param array<string, mixed> $fields
     *
     * @return array<string, mixed>
     */
    public static function createManual(int $sourceId, string $excerpt, array $fields): array
    {
        $source = Sources::find($sourceId);
        $excerpt = trim($excerpt);
        if (mb_strlen($excerpt) < 3) {
            throw new BadInput('Select the sentence the card is based on.');
        }
        if (mb_strlen($excerpt) > 2000) {
            throw new BadInput('Select a sentence or two rather than a whole section.');
        }
        $found = Text::locate($source['content'], $excerpt);
        if ($found === null) {
            throw new BadInput('That text could not be found in this source. Select it again from the notes.');
        }

        $f = self::clean($fields);
        if ($f['title'] === '') {
            throw new BadInput('Give the card a title.');
        }
        if ($f['kind'] !== 'question' && ($f['card_front'] === '' || $f['card_back'] === '')) {
            throw new BadInput('Fill in both sides of the flashcard, or make it an open question.');
        }
        $title = Text::normalize($f['title']);
        foreach (Db::all("SELECT title FROM items WHERE source_id = ? AND kind = ? AND status IN ('pending', 'approved')", [$sourceId, $f['kind']]) as $existing) {
            if (Text::normalize($existing['title']) === $title) {
                throw new BadInput("You already have an item called “{$f['title']}” from this source.");
            }
        }

        $id = Db::transaction(function () use ($f, $sourceId, $excerpt, $found): int {
            $now = now_iso();
            $id = Db::insert('items', self::encode($f) + [
                'source_id' => $sourceId,
                'status' => 'approved',
                'origin' => 'manual',
                'model' => '',
                'created_at' => $now,
                'reviewed_at' => $now,
                'due_at' => $now,
            ]);
            Db::insert('excerpts', [
                'item_id' => $id,
                'source_id' => $sourceId,
                'text' => $found['text'],
                'quoted' => $excerpt,
                'start' => $found['start'],
                'length' => $found['length'],
                'match' => $found['match'],
            ]);
            self::log($id, 'created');
            return $id;
        });
        return self::show($id);
    }

    /**
     * @param array<string, mixed> $in
     *
     * @return array{kind: string, title: string, statement: string, interpretation: string, card_front: string, card_back: string, steps: list<string>, tags: list<string>}
     */
    public static function clean(array $in): array
    {
        $kind = (string) ($in['kind'] ?? '');
        $steps = array_values(array_filter(
            array_map(fn ($s) => Text::clip((string) $s, 500), is_array($in['steps'] ?? null) ? $in['steps'] : []),
            fn ($s) => $s !== ''
        ));
        $tags = array_values(array_unique(array_filter(
            array_map(fn ($t) => Text::tag((string) $t), is_array($in['tags'] ?? null) ? $in['tags'] : []),
            fn ($t) => $t !== ''
        )));
        return [
            'kind' => in_array($kind, ClaudeExtractor::KINDS, true) ? $kind : 'concept',
            'title' => Text::clip((string) ($in['title'] ?? ''), 200),
            'statement' => Text::clip((string) ($in['statement'] ?? ''), 2000),
            'interpretation' => Text::clip((string) ($in['interpretation'] ?? ''), 3000),
            'card_front' => Text::clip((string) ($in['card_front'] ?? ''), 1000),
            'card_back' => Text::clip((string) ($in['card_back'] ?? ''), 2000),
            'steps' => array_slice($steps, 0, 30),
            'tags' => array_slice($tags, 0, 6),
        ];
    }

    /** @return array<string, mixed> fields ready for the items table */
    private static function encode(array $fields): array
    {
        $fields['steps'] = json_encode($fields['steps'], JSON_UNESCAPED_UNICODE);
        $fields['tags'] = json_encode($fields['tags'], JSON_UNESCAPED_UNICODE);
        return $fields;
    }

    /** @return array<string, mixed> */
    public static function find(int $id): array
    {
        $row = Db::one('SELECT * FROM items WHERE id = ?', [$id]);
        if ($row === null) {
            throw new NotFound('That item no longer exists.');
        }
        return $row;
    }

    /** @return array<string, mixed> */
    public static function show(int $id): array
    {
        return self::present([self::find($id)], true)[0];
    }

    /**
     * Shapes rows for the API, attaching each item's excerpts (and, optionally, the
     * surrounding source text so the reviewer sees the sentence in context).
     *
     * @param list<array<string, mixed>> $rows
     *
     * @return list<array<string, mixed>>
     */
    public static function present(array $rows, bool $withContext = false): array
    {
        if (!$rows) {
            return [];
        }
        $ids = array_map(fn ($r) => (int) $r['id'], $rows);
        $marks = implode(',', array_fill(0, count($ids), '?'));
        $excerpts = [];
        foreach (Db::all("SELECT * FROM excerpts WHERE item_id IN ($marks) ORDER BY id", $ids) as $x) {
            $excerpts[(int) $x['item_id']][] = $x;
        }
        $sourceIds = array_values(array_unique(array_filter(array_map(fn ($r) => (int) $r['source_id'], $rows))));
        $sources = [];
        if ($sourceIds) {
            $sMarks = implode(',', array_fill(0, count($sourceIds), '?'));
            $columns = $withContext ? 'id, title, content' : 'id, title';
            foreach (Db::all("SELECT $columns FROM sources WHERE id IN ($sMarks)", $sourceIds) as $s) {
                $sources[(int) $s['id']] = $s;
            }
        }

        $out = [];
        foreach ($rows as $r) {
            $id = (int) $r['id'];
            $itemExcerpts = [];
            foreach ($excerpts[$id] ?? [] as $x) {
                $entry = [
                    'id' => (int) $x['id'],
                    'source_id' => (int) $x['source_id'],
                    'source_title' => $sources[(int) $x['source_id']]['title'] ?? '',
                    'text' => Text::display($x['text']),
                    'quoted' => $x['quoted'],
                    'match' => $x['match'],
                    'start' => $x['start'] === null ? null : (int) $x['start'],
                ];
                if ($withContext) {
                    $content = $sources[(int) $x['source_id']]['content'] ?? null;
                    $entry['context'] = ($content !== null && $x['start'] !== null)
                        ? Text::context($content, (int) $x['start'], (int) $x['length'])
                        : null;
                }
                $itemExcerpts[] = $entry;
            }
            $out[] = [
                'id' => $id,
                'source_id' => $r['source_id'] === null ? null : (int) $r['source_id'],
                'source_title' => $sources[(int) $r['source_id']]['title'] ?? '',
                'kind' => $r['kind'],
                'title' => $r['title'],
                'statement' => $r['statement'],
                'interpretation' => $r['interpretation'],
                'card_front' => $r['card_front'],
                'card_back' => $r['card_back'],
                'steps' => json_decode($r['steps'], true) ?: [],
                'tags' => json_decode($r['tags'], true) ?: [],
                'status' => $r['status'],
                'origin' => $r['origin'],
                'model' => $r['model'],
                'edited' => (bool) $r['edited'],
                'draft' => $r['draft'] ? json_decode($r['draft'], true) : null,
                'merged_into' => $r['merged_into'] === null ? null : (int) $r['merged_into'],
                'box' => (int) $r['box'],
                'due_at' => $r['due_at'],
                'times_right' => (int) $r['times_right'],
                'times_wrong' => (int) $r['times_wrong'],
                'last_studied_at' => $r['last_studied_at'],
                'created_at' => $r['created_at'],
                'reviewed_at' => $r['reviewed_at'],
                'excerpts' => $itemExcerpts,
            ];
        }
        return $out;
    }

    /**
     * @param array<string, mixed> $changes
     *
     * @return array<string, mixed>
     */
    public static function update(int $id, array $changes): array
    {
        $row = self::find($id);
        $current = [
            'kind' => $row['kind'], 'title' => $row['title'], 'statement' => $row['statement'],
            'interpretation' => $row['interpretation'], 'card_front' => $row['card_front'], 'card_back' => $row['card_back'],
            'steps' => json_decode($row['steps'], true) ?: [], 'tags' => json_decode($row['tags'], true) ?: [],
        ];
        $allowed = array_intersect_key($changes, $current);
        $fields = self::clean($allowed + $current);
        if ($fields['title'] === '') {
            throw new BadInput('An item needs a title.');
        }

        $edited = false;
        if ($row['draft']) {
            $draft = self::clean(json_decode($row['draft'], true) ?: []);
            foreach (self::CONTENT_FIELDS as $f) {
                if ($fields[$f] !== $draft[$f]) {
                    $edited = true;
                    break;
                }
            }
        }

        $encoded = self::encode($fields);
        $sets = implode(', ', array_map(fn ($c) => "$c = :$c", array_keys($encoded)));
        Db::run("UPDATE items SET $sets, edited = :edited WHERE id = :id", $encoded + ['edited' => (int) $edited, 'id' => $id]);
        return self::show($id);
    }

    /** @return array<string, mixed> */
    public static function approve(int $id, ?array $changes = null): array
    {
        if ($changes) {
            self::update($id, $changes);
        }
        $row = self::find($id);
        if (!in_array($row['status'], ['pending', 'discarded'], true)) {
            throw new BadInput('Only items waiting for review can be approved.');
        }
        Db::run('UPDATE items SET status = ?, reviewed_at = ?, due_at = COALESCE(due_at, ?) WHERE id = ?', ['approved', now_iso(), now_iso(), $id]);
        self::log($id, $row['edited'] ? 'approved_edited' : 'approved');
        return self::show($id);
    }

    /** @return array<string, mixed> */
    public static function discard(int $id): array
    {
        $row = self::find($id);
        if ($row['status'] === 'merged') {
            throw new BadInput('This item was merged into another one.');
        }
        Db::run('UPDATE items SET status = ?, reviewed_at = ? WHERE id = ?', ['discarded', now_iso(), $id]);
        self::log($id, 'discarded');
        return self::show($id);
    }

    /** Sends an approved or discarded item back to the review queue. */
    public static function restore(int $id): array
    {
        $row = self::find($id);
        if (!in_array($row['status'], ['approved', 'discarded'], true)) {
            throw new BadInput('Only approved or discarded items can go back to the queue.');
        }
        Db::run('UPDATE items SET status = ? WHERE id = ?', ['pending', $id]);
        self::log($id, 'restored');
        return self::show($id);
    }

    /**
     * Folds item $id into $into: its excerpts and tags move over, and $id is retired.
     *
     * @return array<string, mixed> the merged target item
     */
    public static function merge(int $id, int $into): array
    {
        if ($id === $into) {
            throw new BadInput('Pick a different item to merge into.');
        }
        $from = self::find($id);
        $target = self::find($into);
        if (in_array($from['status'], ['merged'], true) || in_array($target['status'], ['merged', 'discarded'], true)) {
            throw new BadInput('Items can only be merged into one that is pending or in the library.');
        }
        Db::transaction(function () use ($id, $into, $from, $target): void {
            Db::run('UPDATE excerpts SET item_id = ? WHERE item_id = ?', [$into, $id]);
            $tags = array_values(array_unique(array_merge(json_decode($target['tags'], true) ?: [], json_decode($from['tags'], true) ?: [])));
            Db::run('UPDATE items SET tags = ? WHERE id = ?', [json_encode(array_slice($tags, 0, 6), JSON_UNESCAPED_UNICODE), $into]);
            Db::run('UPDATE items SET status = ?, merged_into = ?, reviewed_at = ? WHERE id = ?', ['merged', $into, now_iso(), $id]);
            self::log($id, 'merged');
        });
        return self::show($into);
    }

    /**
     * Records one study answer and reschedules the card (Leitner boxes).
     *
     * @return array<string, mixed>
     */
    public static function grade(int $id, string $result, string $mode): array
    {
        $row = self::find($id);
        if ($row['status'] !== 'approved') {
            throw new BadInput('Only items in your library can be studied.');
        }
        $box = (int) $row['box'];
        $right = (int) $row['times_right'];
        $wrong = (int) $row['times_wrong'];
        $due = $row['due_at'];
        switch ($result) {
            case 'again':
            case 'wrong':
                $box = 1;
                $wrong++;
                $due = now_iso();
                break;
            case 'good':
            case 'easy':
                $box = min(5, max(1, $box) + ($result === 'easy' ? 2 : 1));
                $right++;
                $due = now_iso(self::BOX_DAYS[$box] * 86400);
                break;
            case 'right':
                $box = max(1, $box);
                $right++;
                $due ??= now_iso();
                break;
            default:
                throw new BadInput('Unknown result.');
        }
        $now = now_iso();
        Db::run(
            'UPDATE items SET box = ?, due_at = ?, times_right = ?, times_wrong = ?, last_studied_at = ? WHERE id = ?',
            [$box, $due, $right, $wrong, $now, $id]
        );
        Db::insert('study_log', ['item_id' => $id, 'mode' => in_array($mode, ['flashcard', 'quiz', 'session'], true) ? $mode : 'flashcard', 'result' => $result, 'at' => $now]);
        return ['id' => $id, 'box' => $box, 'due_at' => $due];
    }

    /**
     * Library search over approved items (or another status).
     *
     * @param array<string, mixed> $f q, kind, tag, source_id, status, sort, limit
     *
     * @return list<array<string, mixed>>
     */
    public static function search(array $f): array
    {
        $where = ['i.status = :status'];
        $params = ['status' => in_array($f['status'] ?? '', ['pending', 'approved', 'discarded', 'merged'], true) ? $f['status'] : 'approved'];
        if (!empty($f['kind']) && in_array($f['kind'], ClaudeExtractor::KINDS, true)) {
            $where[] = 'i.kind = :kind';
            $params['kind'] = $f['kind'];
        }
        if (!empty($f['source_id'])) {
            $where[] = 'i.source_id = :source_id';
            $params['source_id'] = (int) $f['source_id'];
        }
        if (!empty($f['tag'])) {
            $where[] = 'EXISTS (SELECT 1 FROM json_each(i.tags) WHERE json_each.value = :tag)';
            $params['tag'] = (string) $f['tag'];
        }
        $terms = preg_split('/\s+/u', trim((string) ($f['q'] ?? '')), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        foreach (array_slice($terms, 0, 8) as $n => $term) {
            $p = "t$n";
            $params[$p] = '%' . addcslashes($term, '%_\\') . '%';
            $where[] = "(i.title LIKE :$p ESCAPE '\\' OR i.statement LIKE :$p ESCAPE '\\' OR i.card_front LIKE :$p ESCAPE '\\'"
                . " OR i.card_back LIKE :$p ESCAPE '\\' OR i.interpretation LIKE :$p ESCAPE '\\' OR i.tags LIKE :$p ESCAPE '\\'"
                . " OR i.steps LIKE :$p ESCAPE '\\' OR EXISTS (SELECT 1 FROM excerpts x WHERE x.item_id = i.id AND x.text LIKE :$p ESCAPE '\\'))";
        }
        $order = match ($f['sort'] ?? '') {
            'title' => 'i.title COLLATE NOCASE',
            'oldest' => 'i.id',
            'weakest' => '(i.times_wrong - i.times_right) DESC, i.box',
            'source' => 'i.source_id, i.id',
            default => 'COALESCE(i.reviewed_at, i.created_at) DESC, i.id DESC',
        };
        $limit = max(1, min(500, (int) ($f['limit'] ?? 300)));
        $rows = Db::all('SELECT i.* FROM items i WHERE ' . implode(' AND ', $where) . " ORDER BY $order LIMIT $limit", $params);
        return self::present($rows, (bool) ($f['context'] ?? false));
    }

    /** @return list<array{tag: string, count: int}> */
    public static function tags(): array
    {
        return array_map(
            fn ($r) => ['tag' => $r['tag'], 'count' => (int) $r['n']],
            Db::all("SELECT json_each.value AS tag, COUNT(*) AS n FROM items, json_each(items.tags) WHERE items.status = 'approved' GROUP BY json_each.value ORDER BY n DESC, tag")
        );
    }

    private static function log(int $id, string $action): void
    {
        Db::insert('review_log', ['item_id' => $id, 'action' => $action, 'at' => now_iso()]);
    }
}
