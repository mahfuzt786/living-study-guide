<?php

declare(strict_types=1);

namespace StudyApp;

/** A failure the learner can understand and act on (shown in the UI as-is). */
final class ExtractionError extends \RuntimeException
{
    public function __construct(string $message, public readonly bool $retryable = false)
    {
        parent::__construct($message);
    }
}
