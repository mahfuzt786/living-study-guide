<?php

// Unit tests for the parts that keep cards tied to the learner's notes.
// No framework needed:  php tests/unit.php   (exit code 1 on any failure)

declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use StudyApp\Config;
use StudyApp\Items;
use StudyApp\LocalExtractor;
use StudyApp\Text;

$passed = 0;
$failed = [];

function check(string $name, bool $ok, string $detail = ''): void
{
    global $passed, $failed;
    if ($ok) {
        $passed++;
        echo "  ok    $name\n";
    } else {
        $failed[] = $name;
        echo "  FAIL  $name" . ($detail !== '' ? " — $detail" : '') . "\n";
    }
}

$demo = str_replace("\r\n", "\n", (string) file_get_contents(APP_ROOT . '/demo/how-memory-works.md'));

echo "Text::locate\n";
$exact = Text::locate($demo, 'Cramming is massed practice');
check('finds a verbatim quote', ($exact['match'] ?? '') === 'exact');
check('gives back the final full stop the quote left out', ($exact['text'] ?? '') === 'Cramming is massed practice.');
$bold = Text::locate($demo, 'Encoding: the process of turning what you perceive into a memory trace');
check('ignores markdown emphasis in the notes', ($bold['match'] ?? '') === 'exact');
$curly = Text::locate($demo, 'cramming is “massed practice”');
check('treats a quote with added curly quotes as close, not exact', ($curly['match'] ?? '') === 'close');
$para = Text::locate($demo, 'Ebbinghaus published experiments on memory in 1885');
check('maps a paraphrase to the closest real sentence', ($para['text'] ?? '') === 'Hermann Ebbinghaus published his experiments on memory in 1885.');
$ellipsis = Text::locate($demo, 'Forgetting was fastest in the first hours ... then slowed down');
check('accepts a quote shortened with "..."', ($ellipsis['match'] ?? '') === 'close');
check('reports an invented sentence as missing', Text::locate($demo, 'Rome fell in 476 AD because of barbarian invasions.') === null);
check('offsets point at the quoted text', $exact !== null && mb_substr($demo, $exact['start'], $exact['length']) === $exact['text']);

echo "Text::chunks\n";
$chunks = Text::chunks($demo, 600);
check('splits long notes into several parts', count($chunks) > 1, (string) count($chunks));
$roundTrip = true;
foreach ($chunks as $c) {
    $roundTrip = $roundTrip && mb_substr($demo, $c['start'], mb_strlen($c['text'])) === $c['text'];
}
check('every part is an exact slice of the notes', $roundTrip);
check('short notes stay in one part', count(Text::chunks('One short note.', 600)) === 1);

echo "Text::context\n";
$ctx = Text::context($demo, $exact['start'], $exact['length']);
check('context ends the line before at a line boundary', str_ends_with($ctx['before'], "\n"));
$boldCtx = Text::context($demo, $bold['start'], $bold['length']);
check('context strips markdown markers for display', !str_contains($boldCtx['before'] . $boldCtx['text'] . $boldCtx['after'], '**'));
check('display() removes emphasis markers', Text::display('**Encoding**: `x`') === 'Encoding: x');

echo "LocalExtractor\n";
$items = (new LocalExtractor())->extract($demo);
check('drafts 18 items from the demo notes', count($items) === 18, (string) count($items));
$allExact = true;
foreach ($items as $it) {
    $allExact = $allExact && (Text::locate($demo, $it['excerpt'])['match'] ?? '') === 'exact';
}
check('every offline excerpt is an exact quote', $allExact);
$kinds = array_count_values(array_column($items, 'kind'));
check('finds the 4 glossary terms and more', ($kinds['term'] ?? 0) >= 4);
check('finds the 2 open questions', ($kinds['question'] ?? 0) === 2);
$howto = array_values(array_filter($items, fn ($i) => $i['kind'] === 'howto'));
check('finds the how-to with its 4 steps', count($howto) === 1 && count($howto[0]['steps']) === 4);
check('asks how-to questions naturally', ($howto[0]['card_front'] ?? '') === 'How do you run a Leitner review session?');
check('never writes an AI interpretation', count(array_filter($items, fn ($i) => $i['interpretation'] !== '')) === 0);

$meeting = "Agenda: budget review and hiring plan.\nToday: we covered the roadmap.\nBurn rate: the amount of cash spent each month.\nNext steps:\n1. Draft the hiring plan.\n2. Share the budget sheet.";
$m = (new LocalExtractor())->extract($meeting);
$titles = array_column($m, 'title');
check('skips labels such as "Agenda:" and "Today:"', !in_array('Agenda', $titles, true) && !in_array('Today', $titles, true));
check('keeps a real "Term: definition" line', in_array('Burn rate', $titles, true));
check('phrases a steps list naturally', in_array('What are the next steps?', array_column($m, 'card_front'), true));

echo "Items::clean\n";
$clean = Items::clean(['kind' => 'nonsense', 'title' => '  Title  ', 'tags' => ['Memory Basics', 'memory basics', ''], 'steps' => ['  one ', '', 'two']]);
check('falls back to a valid kind', $clean['kind'] === 'concept');
check('trims fields', $clean['title'] === 'Title');
check('lowercases and de-duplicates tags', $clean['tags'] === ['memory basics']);
check('drops empty steps', $clean['steps'] === ['one', 'two']);

echo "Config\n";
putenv('STUDY_EFFORT=bogus');
check('rejects an unknown effort level', Config::effort() === 'medium');
putenv('STUDY_EFFORT=high');
check('accepts a valid effort level', Config::effort() === 'high');
putenv('STUDY_EFFORT');

echo "\n" . $passed . ' passed, ' . count($failed) . " failed\n";
exit($failed ? 1 : 0);
