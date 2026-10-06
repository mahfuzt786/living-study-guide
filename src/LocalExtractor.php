<?php

declare(strict_types=1);

namespace StudyApp;

/**
 * Rule-based extractor used when no Claude API key is configured.
 *
 * It never writes new prose: statements are the learner's own sentences, and
 * cards are built by turning those sentences into questions or cloze gaps.
 * That makes it less clever than Claude but impossible to "invent" facts with.
 */
final class LocalExtractor
{
    private const GENERIC_HEADINGS = [
        'key terms', 'terms', 'glossary', 'definitions', 'vocabulary', 'notes', 'summary', 'overview',
        'introduction', 'questions', 'questions to investigate', 'open questions', 'misc', 'other',
    ];

    private const NON_SUBJECTS = [
        'it', 'this', 'that', 'these', 'those', 'there', 'here', 'they', 'he', 'she', 'we', 'you', 'i',
        'what', 'which', 'who', 'one', 'each', 'all', 'some', 'note', 'notes', 'example', 'tip', 'warning',
        'important', 'source', 'date', 'lecture', 'see', 'todo', 'answer', 'question', 'q', 'a',
        // labels people put in front of a colon that are not terms being defined
        'today', 'tomorrow', 'yesterday', 'agenda', 'summary', 'reminder', 'update', 'action', 'actions',
        'attendees', 'deadline', 'time', 'location', 'room', 'speaker', 'topic', 'title', 'chapter',
        'section', 'page', 'week', 'class', 'professor', 'prof', 'instructor', 'teacher', 'due',
        'homework', 'assignment', 'reading', 'readings', 'next', 'goal', 'goals', 'outcome', 'result',
    ];

    private const MAX_ITEMS = 80;

    /** @return list<array<string, mixed>> */
    public function extract(string $text): array
    {
        $items = [];
        $heading = '';
        $leadIn = null;
        $steps = [];
        $stepLines = [];

        $flushSteps = function () use (&$items, &$steps, &$stepLines, &$leadIn, &$heading): void {
            if (count($steps) >= 2) {
                $title = $leadIn !== null ? rtrim($leadIn, ': ') : ($heading !== '' ? $heading : 'Steps');
                $isHowTo = $leadIn !== null && preg_match('/\b(how to|steps?|instructions?|procedure|checklist|method)\b/i', $leadIn);
                $front = match (true) {
                    (bool) preg_match('/^how to (.+)$/i', $title, $m) => 'How do you ' . $m[1] . '?',
                    (bool) preg_match('/\bsteps?\b/i', $title) => 'What are the ' . self::lowerFirst($title) . '?',
                    default => 'What are the steps of ' . self::lowerFirst($title) . '?',
                };
                $numbered = [];
                foreach ($steps as $i => $step) {
                    $numbered[] = ($i + 1) . '. ' . $step;
                }
                $items[] = $this->item(
                    kind: $isHowTo ? 'howto' : 'process',
                    title: $title,
                    statement: implode(' ', array_map(fn ($s) => rtrim($s, '.') . '.', $steps)),
                    front: $front,
                    back: implode("\n", $numbered),
                    excerpt: ($leadIn !== null ? $leadIn . "\n" : '') . implode("\n", $stepLines),
                    heading: $heading,
                    steps: $steps,
                );
            }
            $steps = [];
            $stepLines = [];
            $leadIn = null;
        };

        foreach (preg_split('/\R/u', $text) ?: [] as $raw) {
            $line = trim($raw);
            if ($line === '') {
                if ($steps) {
                    $flushSteps();
                }
                continue;
            }
            if (preg_match('/^#{1,6}\s+(.+?)\s*#*$/u', $line, $m)) {
                $flushSteps();
                $heading = self::plain($m[1]);
                continue;
            }
            if (preg_match('/^\d{1,2}[.)]\s+(.+)$/u', $line, $m)) {
                $steps[] = self::plain($m[1]);
                $stepLines[] = $line;
                continue;
            }
            if ($steps) {
                $flushSteps();
            }

            $isBullet = (bool) preg_match('/^[-*•+]\s+(.+)$/u', $line, $m);
            if ($isBullet) {
                $line = $m[1];
            }

            if ($term = self::glossaryEntry($line, $isBullet)) {
                [$name, $definition] = $term;
                $items[] = $this->item(
                    kind: 'term',
                    title: $name,
                    statement: $line,
                    front: 'What is meant by "' . $name . '"?',
                    back: self::upperFirst($definition),
                    excerpt: $line,
                    heading: $heading,
                );
                continue;
            }

            if (str_ends_with($line, ':') && mb_strlen($line) <= 120) {
                $leadIn = self::plain($line);
                continue;
            }

            foreach (Text::sentences($line) as $sentence) {
                if ($item = $this->fromSentence(self::plain($sentence['text']), $heading)) {
                    $items[] = $item;
                }
            }
        }
        $flushSteps();

        $seen = [];
        $unique = [];
        foreach ($items as $item) {
            $key = $item['kind'] . '|' . Text::normalize($item['title']);
            if (!isset($seen[$key])) {
                $seen[$key] = true;
                $unique[] = $item;
            }
        }
        return array_slice($unique, 0, self::MAX_ITEMS);
    }

    /** @return array<string, mixed>|null */
    private function fromSentence(string $s, string $heading): ?array
    {
        if (mb_strlen($s) < 12) {
            return null;
        }

        if (str_ends_with($s, '?')) {
            return $this->item(kind: 'question', title: $s, statement: $s, front: $s, back: '', excerpt: $s, heading: $heading);
        }

        $definition = '/^(?:(?<article>A|An|The)\s+)?(?<subj>\p{L}[\p{L}\p{N}\s\'’\-]{0,60}?)\s+(?<verb>is defined as|refers to|means|describes|is|are)\s+(?<pred>.{6,})$/u';
        if (preg_match($definition, $s, $m)) {
            $subject = trim($m['subj']);
            $words = preg_split('/\s+/u', $subject) ?: [];
            if (count($words) <= 5 && !in_array(mb_strtolower($words[0]), self::NON_SUBJECTS, true)) {
                $verb = $m['verb'];
                $named = $m['article'] !== '' ? strtolower($m['article']) . ' ' . $subject : self::lowerFirst($subject);
                $front = match ($verb) {
                    'means' => "What does {$named} mean?",
                    'refers to' => "What does {$named} refer to?",
                    'is defined as' => "How is {$named} defined?",
                    'describes' => "What does {$named} describe?",
                    'are' => "What are {$named}?",
                    default => "What is {$named}?",
                };
                $back = $verb === 'describes' ? $m['pred'] : preg_replace('/^that\s+/u', '', $m['pred']);
                return $this->item(
                    kind: in_array($verb, ['means', 'refers to', 'is defined as'], true) ? 'term' : 'concept',
                    title: self::upperFirst($subject),
                    statement: $s,
                    front: $front,
                    back: self::upperFirst((string) $back),
                    excerpt: $s,
                    heading: $heading,
                );
            }
        }

        // A dated fact becomes a cloze card: the year is the gap.
        $words = preg_split('/\s+/u', $s) ?: [];
        if (count($words) <= 40 && preg_match('/(?<![\d,.])(1\d{3}|20\d{2})(?![\d,])/u', $s, $m, PREG_OFFSET_CAPTURE)) {
            $year = $m[1][0];
            $gapped = substr_replace($s, '_____', $m[1][1], strlen($year));
            return $this->item(
                kind: 'concept',
                title: Text::clip(rtrim($s, '.'), 70),
                statement: $s,
                front: ($heading !== '' ? $heading . ': ' : '') . $gapped,
                back: $year,
                excerpt: $s,
                heading: $heading,
            );
        }

        return null;
    }

    /** @return array{0: string, 1: string}|null [term, definition] */
    private static function glossaryEntry(string $line, bool $isBullet): ?array
    {
        // "**Term**: definition", "- Term: definition", or a plain "Term: definition" line with a short term.
        if (preg_match('/^\*\*(.{1,60}?)\*\*\s*[:\x{2013}\x{2014}-]\s*(.{6,})$/u', $line, $m)
            || ($isBullet && preg_match('/^([\p{Lu}][^:]{1,50}):\s+(.{6,})$/u', $line, $m))
            || (preg_match('/^([\p{Lu}][^:]{1,40}):\s+(\S+(?:\s+\S+){2,}.*)$/u', $line, $m) && count(preg_split('/\s+/u', trim($m[1])) ?: []) <= 4)) {
            $term = self::plain($m[1]);
            $first = mb_strtolower(preg_split('/\s+/u', $term)[0] ?? '');
            if (count(preg_split('/\s+/u', $term) ?: []) <= 6 && !in_array($first, self::NON_SUBJECTS, true)) {
                return [$term, self::plain($m[2])];
            }
        }
        return null;
    }

    /** @param list<string> $steps */
    private function item(string $kind, string $title, string $statement, string $front, string $back, string $excerpt, string $heading, array $steps = []): array
    {
        $tag = Text::tag($heading);
        return [
            'kind' => $kind,
            'title' => self::plain($title),
            'statement' => self::plain($statement),
            'card_front' => $front,
            'card_back' => $back,
            'interpretation' => '',
            'steps' => $steps,
            'tags' => $tag !== '' && !in_array($tag, self::GENERIC_HEADINGS, true) ? [$tag] : [],
            'excerpt' => $excerpt,
            'model' => '',
        ];
    }

    /** Strips markdown emphasis. */
    private static function plain(string $s): string
    {
        return trim(preg_replace('/(\*\*|__|`)/u', '', $s) ?? $s);
    }

    private static function upperFirst(string $s): string
    {
        return mb_strtoupper(mb_substr($s, 0, 1)) . mb_substr($s, 1);
    }

    /** Lowercases a leading capital that is only there because the word starts a sentence. */
    private static function lowerFirst(string $s): string
    {
        return preg_match('/^\p{Lu}\p{Ll}/u', $s) ? mb_strtolower(mb_substr($s, 0, 1)) . mb_substr($s, 1) : $s;
    }
}
