<?php

declare(strict_types=1);

namespace StudyApp;

/** Full export/import of the study guide (everything except the login). */
final class Backup
{
    private const FORMAT = 'living-study-guide-backup';
    private const TABLES = ['settings', 'sources', 'items', 'excerpts', 'study_log', 'review_log'];

    /** @return array<string, mixed> */
    public static function export(): array
    {
        $out = ['format' => self::FORMAT, 'version' => 1, 'exported_at' => now_iso()];
        foreach (self::TABLES as $table) {
            $out[$table] = Db::all("SELECT * FROM $table ORDER BY 1");
        }
        return $out;
    }

    /** Replaces all study data with the backup's contents. */
    public static function import(array $data): array
    {
        if (($data['format'] ?? '') !== self::FORMAT) {
            throw new BadInput('That file is not a study guide backup.');
        }
        $columns = [];
        foreach (self::TABLES as $table) {
            if (!isset($data[$table]) || !is_array($data[$table])) {
                throw new BadInput("The backup is missing its \"$table\" section.");
            }
            $columns[$table] = array_column(Db::all("PRAGMA table_info($table)"), 'name');
        }

        Db::pdo()->exec('PRAGMA foreign_keys = OFF');
        try {
            Db::transaction(function () use ($data, $columns): void {
                foreach (array_reverse(self::TABLES) as $table) {
                    Db::run("DELETE FROM $table");
                }
                foreach (self::TABLES as $table) {
                    foreach ($data[$table] as $row) {
                        if (is_array($row)) {
                            Db::insert($table, array_intersect_key($row, array_flip($columns[$table])));
                        }
                    }
                }
            });
        } finally {
            Db::pdo()->exec('PRAGMA foreign_keys = ON');
        }
        return ['sources' => count($data['sources']), 'items' => count($data['items'])];
    }

    /** The approved library as a readable Markdown study guide, with quotes from the notes. */
    public static function markdown(): string
    {
        $md = "# My study guide\n\nExported " . gmdate('j M Y') . ". Every entry was approved by me and quotes the notes it came from.\n";
        foreach (Db::all('SELECT id, title FROM sources ORDER BY id') as $source) {
            $items = Items::search(['source_id' => $source['id'], 'sort' => 'oldest', 'limit' => 500]);
            if (!$items) {
                continue;
            }
            $md .= "\n## " . $source['title'] . "\n";
            foreach ($items as $item) {
                $md .= "\n### " . $item['title'] . ' (' . $item['kind'] . ")\n\n" . $item['statement'] . "\n";
                foreach ($item['steps'] as $n => $step) {
                    $md .= "\n" . ($n + 1) . '. ' . $step;
                }
                if ($item['steps']) {
                    $md .= "\n";
                }
                foreach ($item['excerpts'] as $x) {
                    $md .= "\n> " . str_replace("\n", "\n> ", $x['text']) . "\n";
                }
                if ($item['card_front'] !== '') {
                    $md .= "\n**Q:** " . $item['card_front'] . "  \n**A:** " . str_replace("\n", "  \n", $item['card_back']) . "\n";
                }
                if ($item['interpretation'] !== '') {
                    $md .= "\n*AI interpretation (not from my notes):* " . $item['interpretation'] . "\n";
                }
                if ($item['tags']) {
                    $md .= "\nTags: " . implode(', ', $item['tags']) . "\n";
                }
            }
        }
        return $md;
    }
}
