<?php

declare(strict_types=1);

namespace StudyApp;

final class Study
{
    /**
     * Cards for flashcards or a focused session: due cards first, then weak ones, then new ones.
     *
     * @param array<string, mixed> $f kind, tag, source_id, due_only, size
     *
     * @return list<array<string, mixed>>
     */
    public static function deck(array $f): array
    {
        [$where, $params] = self::scope($f);
        $where[] = "i.card_front <> '' AND i.card_back <> ''";
        if (!empty($f['due_only'])) {
            $where[] = '(i.due_at IS NULL OR i.due_at <= :now)';
        }
        $params['now'] = now_iso();
        $size = max(1, min(200, (int) ($f['size'] ?? 20)));
        $rows = Db::all(
            'SELECT i.* FROM items i WHERE ' . implode(' AND ', $where) . "
             ORDER BY CASE WHEN i.due_at IS NULL OR i.due_at <= :now THEN 0 ELSE 1 END,
                      CASE WHEN i.times_wrong > i.times_right THEN 0 ELSE 1 END,
                      i.box, i.due_at, random()
             LIMIT $size",
            $params
        );
        return Items::present($rows);
    }

    /**
     * A short quiz built only from approved items. Multiple-choice options are the
     * titles of other approved items, so no wrong answer is ever invented.
     *
     * @param array<string, mixed> $f kind, tag, source_id, size
     *
     * @return list<array<string, mixed>>
     */
    public static function quiz(array $f): array
    {
        [$where, $params] = self::scope($f);
        $where[] = "i.card_back <> ''";
        $size = max(1, min(30, (int) ($f['size'] ?? 8)));
        $picked = Items::present(Db::all('SELECT i.* FROM items i WHERE ' . implode(' AND ', $where) . " ORDER BY random() LIMIT $size", $params));
        // Distractors must look like answers: short names, not whole sentences (cloze-card titles).
        $pool = array_values(array_filter(
            Db::all("SELECT id, title, kind FROM items WHERE status = 'approved' AND kind <> 'question' AND LENGTH(title) <= 70"),
            fn ($p) => count(preg_split('/\s+/u', trim($p['title'])) ?: []) <= 6
        ));

        $questions = [];
        foreach ($picked as $n => $item) {
            $prompt = self::matchPrompt($item);
            $distractors = self::distractors($item, $pool);
            if ($prompt !== null && count($distractors) >= 1 && ($n % 3 !== 2 || $item['card_front'] === '')) {
                $options = array_merge([['id' => $item['id'], 'label' => $item['title']]], $distractors);
                shuffle($options);
                $questions[] = [
                    'type' => 'match',
                    'item' => $item,
                    'prompt' => $prompt,
                    'options' => $options,
                    'answer_id' => $item['id'],
                ];
            } elseif ($item['card_front'] !== '') {
                $questions[] = ['type' => 'recall', 'item' => $item, 'prompt' => $item['card_front']];
            }
        }
        return $questions;
    }

    /** The item's answer with its own title blanked out, or null when that leaves too little to go on. */
    private static function matchPrompt(array $item): ?string
    {
        if (mb_strlen($item['title']) > 70) {
            return null; // long titles are whole sentences (cloze cards); those work better as recall
        }
        $text = $item['card_back'] !== '' && $item['kind'] !== 'howto' ? $item['card_back'] : $item['statement'];
        if ($item['kind'] === 'howto' || $item['kind'] === 'process') {
            $text = $item['steps'] ? implode(' → ', $item['steps']) : $text;
        }
        $names = [$item['title']];
        if (preg_match('/^(?:the|a|an)\s+(.+)$/iu', $item['title'], $m)) {
            $names[] = $m[1];
        }
        foreach ($names as $name) {
            $text = preg_replace('/\b' . preg_quote($name, '/') . '\b/iu', '_____', $text) ?? $text;
        }
        $remaining = preg_split('/\s+/u', trim(str_replace('_____', '', $text)), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        return count($remaining) >= 4 ? $text : null;
    }

    /** @return list<array{id: int, label: string}> up to three other items, same kind first */
    private static function distractors(array $item, array $pool): array
    {
        $same = [];
        $other = [];
        foreach ($pool as $p) {
            if ((int) $p['id'] === $item['id'] || Text::normalize($p['title']) === Text::normalize($item['title'])) {
                continue;
            }
            if ($p['kind'] === $item['kind']) {
                $same[] = $p;
            } else {
                $other[] = $p;
            }
        }
        shuffle($same);
        shuffle($other);
        return array_map(
            fn ($p) => ['id' => (int) $p['id'], 'label' => $p['title']],
            array_slice(array_merge($same, $other), 0, 3)
        );
    }

    /** @return array{0: list<string>, 1: array<string, mixed>} */
    private static function scope(array $f): array
    {
        $where = ["i.status = 'approved'", "i.kind <> 'question'"];
        $params = [];
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
        return [$where, $params];
    }
}
