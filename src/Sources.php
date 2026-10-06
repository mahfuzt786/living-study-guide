<?php

declare(strict_types=1);

namespace StudyApp;

final class Sources
{
    public const MAX_CHARS = 400_000;

    /** @return array<string, mixed> */
    public static function create(string $title, string $topic, string $content, bool $isDemo = false): array
    {
        $content = str_replace(["\r\n", "\r"], "\n", $content);
        $content = trim($content);
        $title = Text::clip($title, 160);
        if ($title === '') {
            throw new BadInput('Give the source a title.');
        }
        if (mb_strlen($content) < 40) {
            throw new BadInput('Paste or upload some notes first (at least a few sentences).');
        }
        if (mb_strlen($content) > self::MAX_CHARS) {
            throw new BadInput('That source is very long. Split it into parts of up to 400,000 characters.');
        }
        $id = Db::insert('sources', [
            'title' => $title,
            'topic' => Text::clip($topic, 120),
            'content' => $content,
            'chunk_count' => count(Text::chunks($content)),
            'is_demo' => (int) $isDemo,
            'created_at' => now_iso(),
        ]);
        return self::summary($id);
    }

    /**
     * Drafts items for one chunk of a source. The browser calls this once per chunk,
     * which keeps each request short and lets it show progress.
     *
     * @return array<string, mixed>
     */
    public static function extractChunk(int $id, int $index, string $mode): array
    {
        $source = self::find($id);
        $chunks = Text::chunks($source['content']);
        if ($index < 0 || $index >= count($chunks)) {
            throw new BadInput('That part of the source does not exist.');
        }
        $chunk = $chunks[$index]['text'];

        if ($mode === 'claude') {
            if (!Config::claudeAvailable()) {
                throw new ExtractionError('No ANTHROPIC_API_KEY is configured, so only the offline extractor is available.');
            }
            @set_time_limit(660);
            $drafts = (new ClaudeExtractor(Config::apiKey(), Config::model(), Config::effort()))
                ->extract($chunk, $source['title'], $source['topic'], self::goal(), $index + 1, count($chunks));
        } else {
            $mode = 'local';
            $drafts = (new LocalExtractor())->extract($chunk);
        }

        $created = Db::transaction(function () use ($source, $drafts, $mode): int {
            $n = 0;
            foreach ($drafts as $draft) {
                if (Items::createDraft($source, $draft, $mode) !== null) {
                    $n++;
                }
            }
            return $n;
        });
        Db::run(
            'UPDATE sources SET chunks_done = MAX(chunks_done, ?), chunk_count = ?, extractor = ? WHERE id = ?',
            [$index + 1, count($chunks), $mode, $id]
        );

        return [
            'source_id' => $id,
            'chunk' => $index,
            'chunks' => count($chunks),
            'drafted' => count($drafts),
            'created' => $created,
            'skipped' => count($drafts) - $created,
            'done' => $index + 1 >= count($chunks),
        ];
    }

    /** The learner's study goal, set under Settings ("Make it yours"). */
    public static function goal(): string
    {
        $subject = Db::setting('goal_subject');
        $focus = Db::setting('goal_focus');
        return trim($subject . ($subject !== '' && $focus !== '' ? ' — ' : '') . $focus);
    }

    /** @return array<string, mixed> */
    public static function find(int $id): array
    {
        $row = Db::one('SELECT * FROM sources WHERE id = ?', [$id]);
        if ($row === null) {
            throw new NotFound('That source no longer exists.');
        }
        return $row;
    }

    /** @return list<array<string, mixed>> */
    public static function all(): array
    {
        $rows = Db::all(<<<'SQL'
            SELECT s.id, s.title, s.topic, s.chunk_count, s.chunks_done, s.extractor, s.is_demo, s.created_at,
                   LENGTH(s.content) AS chars,
                   SUM(i.status = 'pending') AS pending,
                   SUM(i.status = 'approved') AS approved,
                   SUM(i.status = 'discarded') AS discarded
            FROM sources s LEFT JOIN items i ON i.source_id = s.id
            GROUP BY s.id ORDER BY s.id DESC
            SQL);
        return array_map(fn ($r) => self::shape($r), $rows);
    }

    /** @return array<string, mixed> */
    public static function summary(int $id): array
    {
        foreach (self::all() as $s) {
            if ($s['id'] === $id) {
                return $s;
            }
        }
        throw new NotFound('That source no longer exists.');
    }

    /**
     * The full source split into segments, each tagged with the items whose excerpts cover it,
     * so the page can highlight exactly which sentences fed which cards.
     *
     * @return array<string, mixed>
     */
    public static function show(int $id): array
    {
        $source = self::find($id);
        $rows = Db::all(<<<'SQL'
            SELECT x.id AS excerpt_id, x.start, x.length, i.id, i.status, i.title, i.kind
            FROM excerpts x JOIN items i ON i.id = x.item_id
            WHERE x.source_id = ? AND x.start IS NOT NULL AND i.status IN ('pending', 'approved')
            SQL, [$id]);

        $chars = mb_str_split($source['content']);
        $total = count($chars);
        $points = [0 => true, $total => true];
        foreach ($rows as $r) {
            $points[(int) $r['start']] = true;
            $points[min($total, (int) $r['start'] + (int) $r['length'])] = true;
        }
        $points = array_keys($points);
        sort($points);

        $segments = [];
        for ($k = 0; $k < count($points) - 1; $k++) {
            [$a, $b] = [$points[$k], $points[$k + 1]];
            if ($b <= $a) {
                continue;
            }
            $covering = [];
            $excerptIds = [];
            foreach ($rows as $r) {
                if ((int) $r['start'] <= $a && (int) $r['start'] + (int) $r['length'] >= $b) {
                    $covering[(int) $r['id']] = ['id' => (int) $r['id'], 'status' => $r['status'], 'title' => $r['title'], 'kind' => $r['kind']];
                    $excerptIds[] = (int) $r['excerpt_id'];
                }
            }
            $segments[] = [
                'text' => implode('', array_slice($chars, $a, $b - $a)),
                'items' => array_values($covering),
                'excerpts' => $excerptIds,
            ];
        }

        return self::summary($id) + ['segments' => $segments];
    }

    public static function delete(int $id): void
    {
        self::find($id);
        Db::run('DELETE FROM sources WHERE id = ?', [$id]);
    }

    /** @return array<string, mixed> */
    public static function loadDemo(): array
    {
        $file = APP_ROOT . '/demo/how-memory-works.md';
        $content = (string) file_get_contents($file);
        return self::create('How Memory Works — Seminar Week 3 (demo)', 'Study skills', $content, true);
    }

    /** @return array<string, mixed> */
    private static function shape(array $r): array
    {
        return [
            'id' => (int) $r['id'],
            'title' => $r['title'],
            'topic' => $r['topic'],
            'chunk_count' => (int) $r['chunk_count'],
            'chunks_done' => (int) $r['chunks_done'],
            'extractor' => $r['extractor'],
            'is_demo' => (bool) $r['is_demo'],
            'created_at' => $r['created_at'],
            'chars' => (int) $r['chars'],
            'pending' => (int) $r['pending'],
            'approved' => (int) $r['approved'],
            'discarded' => (int) $r['discarded'],
        ];
    }
}
