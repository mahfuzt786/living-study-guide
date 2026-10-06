<?php

declare(strict_types=1);

namespace StudyApp;

final class Dashboard
{
    /** Box 3 and above means the card has survived reviews spread over several days. */
    private const MASTERED_BOX = 3;

    /** @return array<string, mixed> */
    public static function build(): array
    {
        $now = now_iso();
        $counts = Db::one(<<<'SQL'
            SELECT SUM(status = 'approved') AS approved,
                   SUM(status = 'approved' AND kind <> 'question') AS cards,
                   SUM(status = 'pending') AS pending,
                   SUM(status = 'discarded') AS discarded,
                   SUM(status = 'merged') AS merged,
                   SUM(status = 'approved' AND kind <> 'question' AND card_front <> '' AND card_back <> ''
                       AND (due_at IS NULL OR due_at <= :now)) AS due,
                   SUM(status = 'approved' AND kind <> 'question' AND box >= :box) AS mastered,
                   SUM(status = 'approved' AND times_right + times_wrong > 0) AS studied
            FROM items
            SQL, ['now' => $now, 'box' => self::MASTERED_BOX]) ?? [];

        // The latest decision per item tells the story of the review queue.
        $decisions = Db::all(<<<'SQL'
            SELECT action, COUNT(*) AS n FROM review_log r
            WHERE r.id = (SELECT MAX(r2.id) FROM review_log r2 WHERE r2.item_id = r.item_id)
            GROUP BY action
            SQL);
        $review = ['approved' => 0, 'approved_edited' => 0, 'discarded' => 0, 'merged' => 0];
        foreach ($decisions as $d) {
            if (isset($review[$d['action']])) {
                $review[$d['action']] = (int) $d['n'];
            }
        }

        $grounding = ['exact' => 0, 'close' => 0, 'missing' => 0];
        foreach (Db::all("SELECT x.match, COUNT(*) AS n FROM excerpts x JOIN items i ON i.id = x.item_id WHERE i.status IN ('pending', 'approved') GROUP BY x.match") as $g) {
            if (isset($grounding[$g['match']])) {
                $grounding[$g['match']] = (int) $g['n'];
            }
        }

        $byTag = Db::all(<<<'SQL'
            SELECT json_each.value AS label, COUNT(*) AS total,
                   SUM(i.box >= :box) AS mastered,
                   SUM(i.box BETWEEN 1 AND :box - 1) AS learning,
                   SUM(i.times_right) AS right_answers, SUM(i.times_wrong) AS wrong_answers
            FROM items i, json_each(i.tags)
            WHERE i.status = 'approved' AND i.kind <> 'question'
            GROUP BY json_each.value ORDER BY total DESC, label LIMIT 12
            SQL, ['box' => self::MASTERED_BOX]);

        $bySource = Db::all(<<<'SQL'
            SELECT s.title AS label, s.id AS source_id, COUNT(*) AS total,
                   SUM(i.box >= :box) AS mastered,
                   SUM(i.box BETWEEN 1 AND :box - 1) AS learning,
                   SUM(i.times_right) AS right_answers, SUM(i.times_wrong) AS wrong_answers
            FROM items i JOIN sources s ON s.id = i.source_id
            WHERE i.status = 'approved' AND i.kind <> 'question'
            GROUP BY s.id ORDER BY total DESC LIMIT 12
            SQL, ['box' => self::MASTERED_BOX]);

        $weakest = Db::all(<<<'SQL'
            SELECT id, title, kind, times_right, times_wrong, box FROM items
            WHERE status = 'approved' AND times_wrong > 0
            ORDER BY (times_wrong - times_right) DESC, times_wrong DESC, box LIMIT 6
            SQL);

        $questions = Db::all("SELECT id, title FROM items WHERE status = 'approved' AND kind = 'question' ORDER BY id LIMIT 10");

        $activity = array_column(
            Db::all('SELECT at FROM study_log WHERE at >= ? ORDER BY at', [now_iso(-31 * 86400)]),
            'at'
        );
        $accuracy = Db::one("SELECT SUM(result IN ('good', 'easy', 'right')) AS right_answers, COUNT(*) AS answers FROM study_log WHERE at >= ?", [now_iso(-30 * 86400)]) ?? [];

        $int = fn (array $rows) => array_map(fn ($r) => array_map(fn ($v) => is_numeric($v) ? (int) $v : $v, $r), $rows);

        return [
            'counts' => array_map('intval', $counts),
            'review' => $review,
            'grounding' => $grounding,
            'by_tag' => $int($byTag),
            'by_source' => $int($bySource),
            'weakest' => $int($weakest),
            'questions' => $int($questions),
            'activity' => $activity,
            'accuracy' => ['right' => (int) ($accuracy['right_answers'] ?? 0), 'answers' => (int) ($accuracy['answers'] ?? 0)],
            'mastered_box' => self::MASTERED_BOX,
            'goal' => Sources::goal(),
        ];
    }
}
