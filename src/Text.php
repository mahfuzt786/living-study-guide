<?php

declare(strict_types=1);

namespace StudyApp;

/**
 * Text helpers for keeping generated items tied to the learner's own words.
 * All offsets are in Unicode code points (mb_* semantics).
 */
final class Text
{
    /** Characters folded to a plain equivalent before matching quotes against the source. */
    private const FOLD = [
        "\u{2018}" => "'", "\u{2019}" => "'", "\u{201A}" => "'", "\u{201B}" => "'", "\u{2032}" => "'",
        "\u{201C}" => '"', "\u{201D}" => '"', "\u{201E}" => '"', "\u{201F}" => '"', "\u{2033}" => '"',
        "\u{2010}" => '-', "\u{2011}" => '-', "\u{2012}" => '-', "\u{2013}" => '-', "\u{2014}" => '-',
        "\u{2015}" => '-', "\u{2212}" => '-', "\u{2026}" => '...',
    ];

    /** Markdown emphasis and invisible characters are ignored when matching. */
    private const DROP = ['*' => true, '_' => true, '#' => true, '`' => true, "\u{200B}" => true, "\u{FEFF}" => true];

    private const STOPWORDS = [
        'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'by', 'with', 'as', 'is', 'are',
        'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these', 'those', 'from', 'into', 'than', 'then',
        'so', 'not', 'no', 'do', 'does', 'did', 'can', 'will', 'would', 'should', 'there', 'their', 'they', 'you',
    ];

    /**
     * Lowercases, folds quotes/dashes, drops markdown emphasis and collapses whitespace.
     *
     * @return array{0: string, 1: list<int>} normalized text and, for each of its code points,
     *                                        the index of the code point it came from in $s
     */
    public static function normalizeWithMap(string $s): array
    {
        $out = '';
        $map = [];
        $prevSpace = true;
        foreach (mb_str_split($s) as $i => $ch) {
            if (isset(self::DROP[$ch])) {
                continue;
            }
            $rep = self::FOLD[$ch] ?? $ch;
            if (preg_match('/^\s$/u', $rep) === 1) {
                if (!$prevSpace) {
                    $out .= ' ';
                    $map[] = $i;
                    $prevSpace = true;
                }
                continue;
            }
            foreach (mb_str_split(mb_strtolower($rep)) as $rc) {
                $out .= $rc;
                $map[] = $i;
            }
            $prevSpace = false;
        }
        if (str_ends_with($out, ' ')) {
            $out = substr($out, 0, -1);
            array_pop($map);
        }
        return [$out, $map];
    }

    public static function normalize(string $s): string
    {
        return self::normalizeWithMap($s)[0];
    }

    /**
     * Finds where a quoted excerpt sits in the source.
     *
     * "exact" means the quote appears word for word (ignoring case, curly quotes,
     * markdown emphasis and whitespace). "close" means the quote was not verbatim,
     * so the closest run of 1-3 source sentences is returned instead.
     *
     * @return array{start: int, length: int, text: string, match: string}|null
     */
    public static function locate(string $source, string $quote): ?array
    {
        [$ns, $map] = self::cached('norm', $source, fn () => self::normalizeWithMap($source));
        $nq = trim(self::normalize($quote), " .,;:");
        if ($ns === '' || mb_strlen($nq) < 3) {
            return null;
        }

        $pos = mb_strpos($ns, $nq);
        if ($pos !== false) {
            // Quotes are compared without their final punctuation; give it back to the highlight.
            $end = $map[$pos + mb_strlen($nq) - 1] + 1;
            for ($n = 0; $n < 2 && in_array(mb_substr($source, $end, 1), ['.', '!', '?', ')', '"', "'", '”', '’'], true); $n++) {
                $end++;
            }
            return self::range($source, $map[$pos], $end, 'exact');
        }

        // A quote shortened with "..." still counts as close when its pieces appear in order nearby.
        if (str_contains($nq, '...')) {
            $parts = array_values(array_filter(array_map('trim', explode('...', $nq)), fn ($p) => mb_strlen($p) >= 3));
            if ($parts) {
                $first = mb_strpos($ns, $parts[0]);
                $cursor = $first;
                foreach ($parts as $p) {
                    $cursor = $cursor === false ? false : mb_strpos($ns, $p, $cursor);
                }
                if ($first !== false && $cursor !== false) {
                    $last = end($parts);
                    $endPos = $cursor + mb_strlen($last) - 1;
                    if ($endPos - $first < mb_strlen($nq) * 3) {
                        return self::range($source, $map[$first], $map[$endPos] + 1, 'close');
                    }
                }
            }
        }

        return self::closestSentences($source, $quote);
    }

    /** @var array<string, array{0: string, 1: mixed}> one cached result per kind, keyed by source hash */
    private static array $cache = [];

    /** Locating many quotes in one source reuses its normalized form and sentence list. */
    private static function cached(string $kind, string $source, callable $compute): mixed
    {
        $hash = md5($source);
        if (($entry = self::$cache[$kind] ?? null) === null || $entry[0] !== $hash) {
            self::$cache[$kind] = [$hash, $compute()];
        }
        return self::$cache[$kind][1];
    }

    /** @return array{start: int, length: int, text: string, match: string} */
    private static function range(string $source, int $start, int $end, string $match): array
    {
        return [
            'start' => $start,
            'length' => $end - $start,
            'text' => mb_substr($source, $start, $end - $start),
            'match' => $match,
        ];
    }

    /** @return array{start: int, length: int, text: string, match: string}|null */
    private static function closestSentences(string $source, string $quote): ?array
    {
        $q = self::tokens($quote);
        if (count($q) < 3) {
            return null;
        }
        $sentences = self::cached('sentences', $source, fn () => self::sentences($source));
        $best = null;
        $bestScore = 0.0;
        $n = count($sentences);
        for ($i = 0; $i < $n; $i++) {
            $tokens = [];
            for ($w = 0; $w < 3 && $i + $w < $n; $w++) {
                $tokens += self::tokens($sentences[$i + $w]['text']);
                $shared = count(array_intersect_key($q, $tokens));
                $recall = $shared / count($q);
                $precision = $shared / max(1, count($tokens));
                $score = $recall * 0.8 + $precision * 0.2;
                if ($recall >= 0.7 && $score > $bestScore) {
                    $bestScore = $score;
                    $last = $sentences[$i + $w];
                    $best = [$sentences[$i]['start'], $last['start'] + $last['length']];
                }
            }
        }
        return $best ? self::range($source, $best[0], $best[1], 'close') : null;
    }

    /** @return array<string, true> content-word stems */
    public static function tokens(string $s): array
    {
        preg_match_all('/[\p{L}\p{N}]+/u', mb_strtolower($s), $m);
        $out = [];
        foreach ($m[0] as $w) {
            if (mb_strlen($w) < 2 || in_array($w, self::STOPWORDS, true)) {
                continue;
            }
            $out[self::stem($w)] = true;
        }
        return $out;
    }

    public static function stem(string $w): string
    {
        foreach (['ing', 'ed', 'es', 's', 'ly'] as $suffix) {
            if (mb_strlen($w) > mb_strlen($suffix) + 3 && str_ends_with($w, $suffix)) {
                return mb_substr($w, 0, -mb_strlen($suffix));
            }
        }
        return $w;
    }

    /**
     * Splits text into sentences, treating line breaks as boundaries (so bullet lists split per line).
     *
     * @return list<array{text: string, start: int, length: int}>
     */
    public static function sentences(string $s): array
    {
        $out = [];
        if (!preg_match_all('/[^\r\n]+/u', $s, $lines, PREG_OFFSET_CAPTURE)) {
            return [];
        }
        $cp = 0;
        $prevByte = 0;
        foreach ($lines[0] as [$line, $byteOffset]) {
            $cp += mb_strlen(substr($s, $prevByte, $byteOffset - $prevByte));
            $prevByte = $byteOffset;
            $parts = preg_split('/(?<=[.!?])\s+(?=[\p{Lu}\p{N}"\'(\[])/u', $line, -1, PREG_SPLIT_OFFSET_CAPTURE) ?: [];
            foreach ($parts as [$part, $partByte]) {
                $text = trim($part);
                if ($text === '') {
                    continue;
                }
                $lead = strlen($part) - strlen(ltrim($part));
                $out[] = [
                    'text' => $text,
                    'start' => $cp + mb_strlen(substr($line, 0, $partByte + $lead)),
                    'length' => mb_strlen($text),
                ];
            }
        }
        return $out;
    }

    /**
     * Splits long notes into pieces of at most $max characters on paragraph
     * (or, for very long paragraphs, sentence) boundaries.
     *
     * @return list<array{text: string, start: int}>
     */
    public static function chunks(string $s, int $max = 9000): array
    {
        $total = mb_strlen($s);
        if ($total <= $max) {
            return [['text' => $s, 'start' => 0]];
        }
        // Units are [start, end) ranges; paragraphs first, oversized ones split into sentences.
        $units = [];
        $sentences = self::sentences($s);
        $paraStart = null;
        $paraEnd = 0;
        $flush = function () use (&$units, &$paraStart, &$paraEnd, &$paraSentences, $max): void {
            if ($paraStart === null) {
                return;
            }
            if ($paraEnd - $paraStart <= $max) {
                $units[] = [$paraStart, $paraEnd];
            } else {
                foreach ($paraSentences as $sen) {
                    $units[] = [$sen['start'], $sen['start'] + $sen['length']];
                }
            }
            $paraStart = null;
            $paraSentences = [];
        };
        $paraSentences = [];
        foreach ($sentences as $sen) {
            $gap = $paraStart === null ? '' : mb_substr($s, $paraEnd, $sen['start'] - $paraEnd);
            if ($paraStart !== null && preg_match('/\R\s*\R/u', $gap)) {
                $flush();
            }
            $paraStart ??= $sen['start'];
            $paraEnd = $sen['start'] + $sen['length'];
            $paraSentences[] = $sen;
        }
        $flush();

        $chunks = [];
        $cStart = null;
        $cEnd = 0;
        foreach ($units as [$uStart, $uEnd]) {
            if ($cStart !== null && $uEnd - $cStart > $max) {
                $chunks[] = ['text' => mb_substr($s, $cStart, $cEnd - $cStart), 'start' => $cStart];
                $cStart = null;
            }
            $cStart ??= $uStart;
            $cEnd = $uEnd;
        }
        if ($cStart !== null) {
            $chunks[] = ['text' => mb_substr($s, $cStart, $cEnd - $cStart), 'start' => $cStart];
        }
        return $chunks ?: [['text' => $s, 'start' => 0]];
    }

    /**
     * Text around an excerpt, cut at paragraph breaks or word boundaries.
     *
     * @return array{before: string, text: string, after: string, cut_before: bool, cut_after: bool}
     */
    public static function context(string $source, int $start, int $length, int $pad = 280): array
    {
        $total = mb_strlen($source);
        $bStart = max(0, $start - $pad);
        $before = mb_substr($source, $bStart, $start - $bStart);
        $cutBefore = $bStart > 0;
        if (($p = mb_strrpos($before, "\n\n")) !== false) {
            // Stay inside the excerpt's paragraph.
            $before = mb_substr($before, $p + 2);
            $cutBefore = false;
        } elseif ($cutBefore) {
            // Start at a whole line, else a whole sentence, else a whole word.
            foreach (["\n", '. ', ' '] as $boundary) {
                if (($p = mb_strpos($before, $boundary)) !== false) {
                    $before = mb_substr($before, $p + mb_strlen($boundary));
                    break;
                }
            }
        }

        $aStart = $start + $length;
        $after = mb_substr($source, $aStart, $pad);
        $cutAfter = $aStart + $pad < $total;
        if (($p = mb_strpos($after, "\n\n")) !== false) {
            $after = mb_substr($after, 0, $p);
            $cutAfter = false;
        } elseif ($cutAfter) {
            foreach (["\n", '. ', ' '] as $boundary) {
                if (($p = mb_strrpos($after, $boundary)) !== false && $p > 0) {
                    $after = mb_substr($after, 0, $p + ($boundary === '. ' ? 1 : 0));
                    break;
                }
            }
        }

        return [
            'before' => self::display(ltrim($before, "\r\n")),
            'text' => self::display(mb_substr($source, $start, $length)),
            'after' => self::display(rtrim($after)),
            'cut_before' => $cutBefore,
            'cut_after' => $cutAfter,
        ];
    }

    /** Source text as shown to the reader: markdown emphasis markers removed. */
    public static function display(string $s): string
    {
        return str_replace(['**', '__', '`'], '', $s);
    }

    public static function tag(string $s): string
    {
        $t = mb_strtolower(trim(preg_replace('/[^\p{L}\p{N}\s\-]+/u', '', $s) ?? ''));
        $t = preg_replace('/\s+/u', ' ', $t) ?? '';
        return mb_substr($t, 0, 40);
    }

    public static function clip(string $s, int $max): string
    {
        $s = trim($s);
        return mb_strlen($s) > $max ? rtrim(mb_substr($s, 0, $max - 1)) . '…' : $s;
    }
}
